// Package users 提供 panel 用户表的 CRUD 与 bcrypt 密码处理。
package users

import (
	"context"
	"errors"
	"time"

	"github.com/0xUnixIO/incuspace/internal/db"
	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

var (
	ErrNotFound        = errors.New("用户不存在")
	ErrInvalidPassword = errors.New("密码错误")
)

type User struct {
	ID        types.ID  `json:"id"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type Repo struct {
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

func (r *Repo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

func (r *Repo) ByUsername(ctx context.Context, username string) (*User, string, error) {
	row := r.pool.QueryRow(ctx, `
SELECT id, username, password_hash, role, created_at
FROM users WHERE username = $1
`, username)
	var u User
	var hash string
	err := row.Scan(&u.ID, &u.Username, &hash, &u.Role, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	return &u, hash, nil
}

func (r *Repo) Get(ctx context.Context, id types.ID) (*User, error) {
	row := r.pool.QueryRow(ctx, `
SELECT id, username, role, created_at
FROM users WHERE id = $1
`, id.Int64())
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *Repo) List(ctx context.Context) ([]User, error) {
	rows, err := r.pool.Query(ctx, `
SELECT id, username, role, created_at
FROM users ORDER BY created_at ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type CreateInput struct {
	Username string
	Password string
	Role     string
}

func (r *Repo) Create(ctx context.Context, in CreateInput) (*User, error) {
	if in.Role != RoleAdmin && in.Role != RoleUser {
		in.Role = RoleUser
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	id := types.ID(db.NewID())
	_, err = r.pool.Exec(ctx, `
INSERT INTO users (id, username, password_hash, role)
VALUES ($1, $2, $3, $4)
`, id.Int64(), in.Username, string(hash), in.Role)
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *Repo) Delete(ctx context.Context, id types.ID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id.Int64())
	return err
}

func (r *Repo) UpdatePassword(ctx context.Context, id types.ID, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, string(hash), id.Int64())
	return err
}

// Verify 用户名 + 密码校验，成功返回 User
func (r *Repo) Verify(ctx context.Context, username, password string) (*User, error) {
	u, hash, err := r.ByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return nil, ErrInvalidPassword
	}
	return u, nil
}
