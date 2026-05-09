package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/instances"
	"github.com/go-chi/chi/v5"
)

type instanceCtxKey struct{}

// instanceFromCtx 从请求上下文取出已校验所有权的 Instance
func instanceFromCtx(ctx context.Context) *instances.Instance {
	v := ctx.Value(instanceCtxKey{})
	if v == nil {
		return nil
	}
	return v.(*instances.Instance)
}

// OwnerCheck 用于 /instances/{name}/* 路由：
// - 把 URL 中的 name（带 u<uid>- 前缀的实际 Incus 名）查 DB
// - 校验当前用户是该实例 owner，或是 admin
// - 把 *Instance 注入 ctx 以便 handler 复用
func (h *Handler) OwnerCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "name")
		if name == "" {
			next.ServeHTTP(w, r)
			return
		}
		c := auth.FromContext(r.Context())
		if c == nil {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		inst, err := h.insts.GetByName(r.Context(), name)
		if err != nil {
			if errors.Is(err, instances.ErrNotFound) {
				// 实例未在面板登记 → 只允许 admin 访问（兼容历史/手动创建的）
				if !auth.IsAdmin(c) {
					writeError(w, http.StatusNotFound, "实例不存在")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !auth.IsAdmin(c) && inst.OwnerID != c.UserID {
			writeError(w, http.StatusForbidden, "无权访问该实例")
			return
		}
		ctx := context.WithValue(r.Context(), instanceCtxKey{}, inst)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
