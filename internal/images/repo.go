// Package images 管理员维护的 "允许镜像" 白名单。
package images

import (
	"context"
	"errors"
	"time"

	"github.com/0xUnixIO/incuspace/internal/db"
	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("镜像未在白名单")

type AllowedImage struct {
	ID          types.ID  `json:"id"`
	Alias       string    `json:"alias"`
	Source      string    `json:"source"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

const selectCols = `id, alias, source, description, created_at`

func scan(row pgx.Row) (*AllowedImage, error) {
	var i AllowedImage
	if err := row.Scan(&i.ID, &i.Alias, &i.Source, &i.Description, &i.CreatedAt); err != nil {
		return nil, err
	}
	return &i, nil
}

type CreateInput struct {
	Alias       string
	Source      string
	Description string
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*AllowedImage, error) {
	id := types.ID(db.NewID())
	_, err := r.pool.Exec(ctx, `
INSERT INTO allowed_images (id, alias, source, description) VALUES ($1, $2, $3, $4)`,
		id.Int64(), in.Alias, in.Source, in.Description)
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repo) Get(ctx context.Context, id types.ID) (*AllowedImage, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM allowed_images WHERE id = $1`, id.Int64())
	i, err := scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

func (r *Repo) GetByAlias(ctx context.Context, alias string) (*AllowedImage, error) {
	row := r.pool.QueryRow(ctx, `SELECT `+selectCols+` FROM allowed_images WHERE alias = $1`, alias)
	i, err := scan(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return i, err
}

func (r *Repo) List(ctx context.Context) ([]AllowedImage, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+selectCols+` FROM allowed_images ORDER BY alias`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AllowedImage{}
	for rows.Next() {
		i, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *i)
	}
	return out, rows.Err()
}

func (r *Repo) Delete(ctx context.Context, id types.ID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM allowed_images WHERE id = $1`, id.Int64())
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
