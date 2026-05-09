// Package quota 实现实例流量配额持久化（Postgres）与超额自动停机。
//
// Incus 不原生支持流量配额，但提供网卡累计计数器（bytes_received/bytes_sent）。
// 计数器在实例停止时会清零，所以本包必须自己累加：每轮 poll 与上次快照对比，
// 如果观察到回退（重启）则把当前值视为新基线，否则累加 delta。
package quota

import (
	"context"
	"errors"
	"time"

	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("配额不存在")

type Quota struct {
	InstanceID  types.ID  `json:"instance_id"`
	LimitBytes  int64     `json:"limit_bytes"`
	Period      string    `json:"period"`
	Action      string    `json:"action"`
	UsedBytes   int64     `json:"used_bytes"`
	LastBytesRx int64     `json:"last_bytes_rx"`
	LastBytesTx int64     `json:"last_bytes_tx"`
	LastResetAt time.Time `json:"last_reset_at"`
	LastPollAt  time.Time `json:"last_poll_at"`
	Triggered   bool      `json:"triggered"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func scanQuota(row pgx.Row) (*Quota, error) {
	var q Quota
	var lastPoll *time.Time
	if err := row.Scan(
		&q.InstanceID, &q.LimitBytes, &q.Period, &q.Action,
		&q.UsedBytes, &q.LastBytesRx, &q.LastBytesTx,
		&q.LastResetAt, &lastPoll, &q.Triggered,
	); err != nil {
		return nil, err
	}
	if lastPoll != nil {
		q.LastPollAt = *lastPoll
	}
	return &q, nil
}

const selectCols = `instance_id, limit_bytes, period, action, used_bytes, last_bytes_rx, last_bytes_tx, last_reset_at, last_poll_at, triggered`

func (s *Store) Get(ctx context.Context, id types.ID) (*Quota, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM quotas WHERE instance_id = $1`, id)
	q, err := scanQuota(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return q, nil
}

func (s *Store) List(ctx context.Context) ([]Quota, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+selectCols+` FROM quotas`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Quota{}
	for rows.Next() {
		q, err := scanQuota(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *q)
	}
	return out, rows.Err()
}

// Set 创建或更新；保留运行期累计字段
func (s *Store) Set(ctx context.Context, in Quota) error {
	existing, err := s.Get(ctx, in.InstanceID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	now := time.Now()
	if existing == nil {
		_, err := s.pool.Exec(ctx, `
INSERT INTO quotas (instance_id, limit_bytes, period, action, last_reset_at)
VALUES ($1, $2, $3, $4, $5)
`, in.InstanceID, in.LimitBytes, in.Period, in.Action, now)
		return err
	}
	resetAt := existing.LastResetAt
	triggered := existing.Triggered
	if in.Period != existing.Period {
		resetAt = now
	}
	if in.LimitBytes > existing.LimitBytes || in.Action != existing.Action {
		triggered = false
	}
	_, err = s.pool.Exec(ctx, `
UPDATE quotas SET limit_bytes=$2, period=$3, action=$4, last_reset_at=$5, triggered=$6
WHERE instance_id=$1
`, in.InstanceID, in.LimitBytes, in.Period, in.Action, resetAt, triggered)
	return err
}

func (s *Store) Delete(ctx context.Context, id types.ID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM quotas WHERE instance_id = $1`, id)
	return err
}

func (s *Store) Reset(ctx context.Context, id types.ID) error {
	_, err := s.pool.Exec(ctx, `
UPDATE quotas SET used_bytes=0, last_reset_at=$2, triggered=false
WHERE instance_id = $1
`, id, time.Now())
	return err
}

// UpdateCounters 监控线程使用：原子更新累计字段
func (s *Store) UpdateCounters(ctx context.Context, id types.ID, fn func(*Quota)) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	row := tx.QueryRow(ctx, `SELECT `+selectCols+` FROM quotas WHERE instance_id = $1 FOR UPDATE`, id)
	q, err := scanQuota(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	fn(q)
	var lastPoll any
	if !q.LastPollAt.IsZero() {
		lastPoll = q.LastPollAt
	}
	if _, err := tx.Exec(ctx, `
UPDATE quotas SET used_bytes=$2, last_bytes_rx=$3, last_bytes_tx=$4,
                  last_reset_at=$5, last_poll_at=$6, triggered=$7
WHERE instance_id=$1
`, id, q.UsedBytes, q.LastBytesRx, q.LastBytesTx, q.LastResetAt, lastPoll, q.Triggered); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
