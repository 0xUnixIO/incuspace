// Package instances 实例所有权登记 + 端口范围分配。
package instances

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/0xUnixIO/incuspace/internal/db"
	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound      = errors.New("实例未登记")
	ErrPortPoolEmpty = errors.New("端口池已耗尽，无法分配")
)

type Instance struct {
	ID             types.ID  `json:"id"`
	Name           string    `json:"name"` // u<uid>-<display>
	DisplayName    string    `json:"display_name"`
	OwnerID        types.ID  `json:"owner_id"`
	SpecCPU        int       `json:"spec_cpu"`
	SpecMemoryMB   int       `json:"spec_memory_mb"`
	PortRangeStart int       `json:"port_range_start"`
	PortRangeEnd   int       `json:"port_range_end"`
	PlanID         *types.ID `json:"plan_id,omitempty"`
	Image          string    `json:"image"`
	CreatedAt      time.Time `json:"created_at"`
}

// PortPool 全局端口池配置（启动时从 ENV 注入）
type PortPool struct {
	Start            int
	End              int
	PortsPerInstance int
}

type Repo struct {
	pool *pgxpool.Pool
	pp   PortPool
}

func NewRepo(pool *pgxpool.Pool, pp PortPool) *Repo {
	return &Repo{pool: pool, pp: pp}
}

// PrefixedName 把 display name 加上 owner 前缀，用作 Incus 实际名字。
func PrefixedName(ownerID types.ID, displayName string) string {
	return "u" + ownerID.String() + "-" + displayName
}

// StripPrefix 反向：从实际名字剥离 owner 前缀；不匹配则原样返回。
func StripPrefix(ownerID types.ID, name string) string {
	prefix := "u" + ownerID.String() + "-"
	return strings.TrimPrefix(name, prefix)
}

// allocateRangeN 从池子里找出长度为 n 的连续空闲段。
// 调用方需持有 advisory lock 或 SERIALIZABLE 事务避免并发分配冲突。
func (r *Repo) allocateRangeN(ctx context.Context, tx pgx.Tx, n int) (int, int, error) {
	if n <= 0 {
		return 0, 0, fmt.Errorf("ports must be > 0")
	}
	rows, err := tx.Query(ctx, `
SELECT port_range_start, port_range_end FROM instances
WHERE port_range_start IS NOT NULL
ORDER BY port_range_start
`)
	if err != nil {
		return 0, 0, err
	}
	type seg struct{ s, e int }
	var used []seg
	for rows.Next() {
		var s, e int
		if err := rows.Scan(&s, &e); err != nil {
			rows.Close()
			return 0, 0, err
		}
		used = append(used, seg{s, e})
	}
	rows.Close()
	sort.Slice(used, func(i, j int) bool { return used[i].s < used[j].s })

	cursor := r.pp.Start
	for _, u := range used {
		if u.s-cursor >= n {
			return cursor, cursor + n - 1, nil
		}
		if u.e+1 > cursor {
			cursor = u.e + 1
		}
	}
	if r.pp.End-cursor+1 >= n {
		return cursor, cursor + n - 1, nil
	}
	return 0, 0, ErrPortPoolEmpty
}

// CreateInput 创建实例所需的所有元数据
type CreateInput struct {
	OwnerID     types.ID
	DisplayName string
	Name        string // 实际 Incus 名；为空时退化为 PrefixedName(OwnerID, DisplayName)
	CPU         int
	MemoryMB    int
	Ports       int       // 端口数；<=0 时退化用 PortPool.PortsPerInstance
	PlanID      *types.ID // 可选；如果传入会在事务里校验 sold<stock
	PlanStock   *int      // plan 的 stock；nil 表示不限
	Image       string
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Instance, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(42)`); err != nil {
		return nil, err
	}
	// 库存校验（在事务内、advisory lock 持有期间）
	if in.PlanID != nil && in.PlanStock != nil {
		var sold int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM instances WHERE plan_id = $1`, in.PlanID.Int64()).Scan(&sold); err != nil {
			return nil, err
		}
		if sold >= *in.PlanStock {
			return nil, errors.New("套餐已售罄")
		}
	}
	ports := in.Ports
	if ports <= 0 {
		ports = r.pp.PortsPerInstance
	}
	ps, pe, err := r.allocateRangeN(ctx, tx, ports)
	if err != nil {
		return nil, err
	}
	id := types.ID(db.NewID())
	name := in.Name
	if name == "" {
		name = PrefixedName(in.OwnerID, in.DisplayName)
	}
	var planArg any
	if in.PlanID != nil {
		planArg = in.PlanID.Int64()
	}
	_, err = tx.Exec(ctx, `
INSERT INTO instances (id, name, display_name, owner_id, spec_cpu, spec_memory_mb, port_range_start, port_range_end, plan_id, image)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`, id.Int64(), name, in.DisplayName, in.OwnerID.Int64(), in.CPU, in.MemoryMB, ps, pe, planArg, in.Image)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetByName(ctx, name)
}

const selectCols = `id, name, display_name, owner_id, spec_cpu, spec_memory_mb,
COALESCE(port_range_start, 0), COALESCE(port_range_end, 0), plan_id, COALESCE(image, ''), created_at`

func scanInstance(row pgx.Row) (*Instance, error) {
	var i Instance
	if err := row.Scan(&i.ID, &i.Name, &i.DisplayName, &i.OwnerID, &i.SpecCPU, &i.SpecMemoryMB,
		&i.PortRangeStart, &i.PortRangeEnd, &i.PlanID, &i.Image, &i.CreatedAt); err != nil {
		return nil, err
	}
	return &i, nil
}

func (r *Repo) GetByName(ctx context.Context, name string) (*Instance, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM instances WHERE name = $1`, name)
	i, err := scanInstance(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

func (r *Repo) Get(ctx context.Context, id types.ID) (*Instance, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM instances WHERE id = $1`, id.Int64())
	i, err := scanInstance(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

func (r *Repo) ListByOwner(ctx context.Context, ownerID types.ID) ([]Instance, error) {
	return r.queryList(ctx, `SELECT `+selectCols+` FROM instances WHERE owner_id = $1 ORDER BY created_at DESC`, ownerID.Int64())
}

func (r *Repo) ListAll(ctx context.Context) ([]Instance, error) {
	return r.queryList(ctx, `SELECT `+selectCols+` FROM instances ORDER BY created_at DESC`)
}

func (r *Repo) queryList(ctx context.Context, q string, args ...any) ([]Instance, error) {
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Instance{}
	for rows.Next() {
		i, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

func (r *Repo) DeleteByName(ctx context.Context, name string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM instances WHERE name = $1`, name)
	return err
}

func (r *Repo) PortPool() PortPool { return r.pp }
