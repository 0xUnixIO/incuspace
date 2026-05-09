package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/0xUnixIO/incuspace/internal/quota"
)

type QuotaResponse struct {
	Enabled     bool   `json:"enabled"`
	LimitBytes  int64  `json:"limit_bytes"`
	Period      string `json:"period"`
	Action      string `json:"action"`
	UsedBytes   int64  `json:"used_bytes"`
	Triggered   bool   `json:"triggered"`
	LastPollAt  string `json:"last_poll_at,omitempty"`
	LastResetAt string `json:"last_reset_at,omitempty"`
}

func (h *Handler) GetQuota(w http.ResponseWriter, r *http.Request) {
	inst := instanceFromCtx(r.Context())
	if inst == nil || h.quotas == nil {
		writeJSON(w, http.StatusOK, QuotaResponse{})
		return
	}
	q, err := h.quotas.Get(r.Context(), inst.ID)
	if err != nil {
		if errors.Is(err, quota.ErrNotFound) {
			writeJSON(w, http.StatusOK, QuotaResponse{})
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := QuotaResponse{
		Enabled:    true,
		LimitBytes: q.LimitBytes,
		Period:     q.Period,
		Action:     q.Action,
		UsedBytes:  q.UsedBytes,
		Triggered:  q.Triggered,
	}
	if !q.LastPollAt.IsZero() {
		resp.LastPollAt = q.LastPollAt.Format("2006-01-02T15:04:05Z07:00")
	}
	if !q.LastResetAt.IsZero() {
		resp.LastResetAt = q.LastResetAt.Format("2006-01-02T15:04:05Z07:00")
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) PutQuota(w http.ResponseWriter, r *http.Request) {
	inst := instanceFromCtx(r.Context())
	if inst == nil {
		writeError(w, http.StatusNotFound, "实例未登记，无法配置配额")
		return
	}
	if h.quotas == nil {
		writeError(w, http.StatusServiceUnavailable, "配额未启用")
		return
	}
	var req struct {
		LimitBytes int64  `json:"limit_bytes"`
		Period     string `json:"period"`
		Action     string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.LimitBytes < 0 {
		writeError(w, http.StatusBadRequest, "limit_bytes 不能为负")
		return
	}
	switch req.Period {
	case "", "monthly", "total":
	default:
		writeError(w, http.StatusBadRequest, "period 必须是 monthly 或 total")
		return
	}
	switch req.Action {
	case "", "stop", "freeze", "notify":
	default:
		writeError(w, http.StatusBadRequest, "action 必须是 stop / freeze / notify")
		return
	}
	if req.Period == "" {
		req.Period = "monthly"
	}
	if req.Action == "" {
		req.Action = "stop"
	}
	if err := h.quotas.Set(r.Context(), quota.Quota{
		InstanceID: inst.ID,
		LimitBytes: req.LimitBytes,
		Period:     req.Period,
		Action:     req.Action,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteQuota(w http.ResponseWriter, r *http.Request) {
	inst := instanceFromCtx(r.Context())
	if inst == nil || h.quotas == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := h.quotas.Delete(r.Context(), inst.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ResetQuota(w http.ResponseWriter, r *http.Request) {
	inst := instanceFromCtx(r.Context())
	if inst == nil || h.quotas == nil {
		writeError(w, http.StatusNotFound, "实例或配额不存在")
		return
	}
	if err := h.quotas.Reset(r.Context(), inst.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
