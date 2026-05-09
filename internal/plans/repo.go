// Package plans 管理套餐：CPU/内存/流量/带宽/端口数 + 库存。
package plans

import (
	"context"
	"errors"
	"time"

	"github.com/0xUnixIO/incuspace/internal/db"
	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound     = errors.New("套餐不存在")
	ErrSoldOut      = errors.New("套餐已售罄")
	ErrPlanDisabled = errors.New("套餐已下架")
)

type Plan struct {
	ID            types.ID  `json:"id"`
	Name          string    `json:"name"`
	CPU           int       `json:"cpu"`
	MemoryMB      int       `json:"memory_mb"`
	TrafficGB     int       `json:"traffic_gb"`
	BandwidthMbps int       `json:"bandwidth_mbps"`
	Ports         int       `json:"ports"`
	Stock         *int      `json:"stock,omitempty"`
	Sold          int       `json:"sold"`
	Enabled       bool      `json:"enabled"`
	AutoStart     bool      `json:"auto_start"`
	CreatedAt     time.Time `json:"created_at"`
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const selectCols = `p.id, p.name, p.cpu, p.memory_mb, p.traffic_gb, p.bandwidth_mbps, p.ports, p.stock, p.enabled, p.auto_start, p.created_at,
COALESCE((SELECT COUNT(*) FROM instances i WHERE i.plan_id = p.id), 0) AS sold`

func scanPlan(row pgx.Row) (*Plan, error) {
	var p Plan
	if err := row.Scan(&p.ID, &p.Name, &p.CPU, &p.MemoryMB, &p.TrafficGB, &p.BandwidthMbps,
		&p.Ports, &p.Stock, &p.Enabled, &p.AutoStart, &p.CreatedAt, &p.Sold); err != nil {
		return nil, err
	}
	return &p, nil
}

type CreateInput struct {
	Name          string
	CPU           int
	MemoryMB      int
	TrafficGB     int
	BandwidthMbps int
	Ports         int
	Stock         *int
	Enabled       bool
	AutoStart     bool
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*Plan, error) {
	id := types.ID(db.NewID())
	_, err := r.pool.Exec(ctx, `
INSERT INTO plans (id, name, cpu, memory_mb, traffic_gb, bandwidth_mbps, ports, stock, enabled, auto_start)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		id.Int64(), in.Name, in.CPU, in.MemoryMB, in.TrafficGB, in.BandwidthMbps, in.Ports, in.Stock, in.Enabled, in.AutoStart)
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repo) Get(ctx context.Context, id types.ID) (*Plan, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM plans p WHERE p.id = $1`, id.Int64())
	p, err := scanPlan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

func (r *Repo) List(ctx context.Context, enabledOnly bool) ([]Plan, error) {
	q := `SELECT ` + selectCols + ` FROM plans p`
	if enabledOnly {
		q += ` WHERE p.enabled = true`
	}
	q += ` ORDER BY p.created_at`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Plan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

type UpdateInput struct {
	Name          *string
	CPU           *int
	MemoryMB      *int
	TrafficGB     *int
	BandwidthMbps *int
	Ports         *int
	Stock         *int
	StockSet      bool
	Enabled       *bool
	AutoStart     *bool
}

func (r *Repo) Update(ctx context.Context, id types.ID, in UpdateInput) (*Plan, error) {
	_, err := r.pool.Exec(ctx, `
UPDATE plans SET
  name = COALESCE($2, name),
  cpu = COALESCE($3, cpu),
  memory_mb = COALESCE($4, memory_mb),
  traffic_gb = COALESCE($5, traffic_gb),
  bandwidth_mbps = COALESCE($6, bandwidth_mbps),
  ports = COALESCE($7, ports),
  stock = CASE WHEN $9::bool THEN $8 ELSE stock END,
  enabled = COALESCE($10, enabled),
  auto_start = COALESCE($11, auto_start)
WHERE id = $1`,
		id.Int64(), in.Name, in.CPU, in.MemoryMB, in.TrafficGB, in.BandwidthMbps, in.Ports,
		in.Stock, in.StockSet, in.Enabled, in.AutoStart)
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repo) Delete(ctx context.Context, id types.ID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM plans WHERE id = $1`, id.Int64())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CountSold 在事务里算某 plan 当前已售（实例数）。
func CountSold(ctx context.Context, tx pgx.Tx, planID types.ID) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM instances WHERE plan_id = $1`, planID.Int64()).Scan(&n)
	return n, err
}
