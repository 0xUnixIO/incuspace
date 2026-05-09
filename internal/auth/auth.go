package auth

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/0xUnixIO/incuspace/internal/types"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userKey contextKey = "user"

var jwtSecret = []byte(getSecret())

func getSecret() string {
	if s := os.Getenv("JWT_SECRET"); s != "" {
		return s
	}
	return "incus-panel-dev-secret-change-in-prod"
}

// Claims 嵌入到 JWT 的载荷
type Claims struct {
	UserID   types.ID `json:"uid"`
	Username string   `json:"sub"`
	Role     string   `json:"role"`
	jwt.RegisteredClaims
}

func IsAdmin(c *Claims) bool { return c != nil && c.Role == "admin" }

// GenerateToken 给登录成功的用户签 JWT
func GenerateToken(userID types.ID, username, role string) (string, error) {
	c := Claims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	return token.SignedString(jwtSecret)
}

// ValidateToken 解析 JWT 返回 Claims
func ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, err
	}
	c, ok := token.Claims.(*Claims)
	if !ok {
		return nil, jwt.ErrTokenInvalidClaims
	}
	// 兼容 uid 序列化为字符串或数字
	if c.UserID == 0 && c.Username != "" {
		// 没拿到，再尝试从 raw claims 中取
		if mc, _ := token.Claims.(*Claims); mc != nil {
			c = mc
		}
	}
	return c, nil
}

// FromContext 从请求上下文取出 Claims；未登录返回 nil
func FromContext(ctx context.Context) *Claims {
	v := ctx.Value(userKey)
	if v == nil {
		return nil
	}
	c, _ := v.(*Claims)
	return c
}

// Middleware 校验 JWT 并注入 Claims 到上下文
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, `{"message":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		c, err := ValidateToken(strings.TrimPrefix(authHeader, "Bearer "))
		if err != nil || c == nil {
			http.Error(w, `{"message":"invalid token"}`, http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), userKey, c)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin 必须 admin 才放行；用法：r.With(auth.RequireAdmin).Get(...)
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := FromContext(r.Context())
		if !IsAdmin(c) {
			http.Error(w, `{"message":"需要管理员权限"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ParseIDParam 把 URL 中的字符串 ID 解析为 types.ID
func ParseIDParam(s string) (types.ID, error) {
	v, err := strconv.ParseInt(s, 10, 64)
	return types.ID(v), err
}
