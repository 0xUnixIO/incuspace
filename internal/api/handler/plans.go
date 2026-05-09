package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/plans"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListPlans(w http.ResponseWriter, r *http.Request) {
	c := auth.FromContext(r.Context())
	enabledOnly := c == nil || !auth.IsAdmin(c)
	list, err := h.plans.List(r.Context(), enabledOnly)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type planUpsertReq struct {
	Name          string `json:"name"`
	CPU           int    `json:"cpu"`
	MemoryMB      int    `json:"memory_mb"`
	TrafficGB     int    `json:"traffic_gb"`
	BandwidthMbps int    `json:"bandwidth_mbps"`
	Ports         int    `json:"ports"`
	Stock         *int   `json:"stock"`
	Enabled       *bool  `json:"enabled"`
	AutoStart     *bool  `json:"auto_start"`
}

func (h *Handler) CreatePlan(w http.ResponseWriter, r *http.Request) {
	var req planUpsertReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Name == "" || req.CPU <= 0 || req.MemoryMB <= 0 || req.Ports <= 0 {
		writeError(w, http.StatusBadRequest, "name/cpu/memory_mb/ports 必须为正")
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	autoStart := true
	if req.AutoStart != nil {
		autoStart = *req.AutoStart
	}
	p, err := h.plans.Create(r.Context(), plans.CreateInput{
		Name: req.Name, CPU: req.CPU, MemoryMB: req.MemoryMB,
		TrafficGB: req.TrafficGB, BandwidthMbps: req.BandwidthMbps,
		Ports: req.Ports, Stock: req.Stock, Enabled: enabled, AutoStart: autoStart,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *Handler) UpdatePlan(w http.ResponseWriter, r *http.Request) {
	id, err := auth.ParseIDParam(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id 无效")
		return
	}
	// 用 map 区分 "未传" 和 "传 null"
	raw := map[string]json.RawMessage{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	var in plans.UpdateInput
	if v, ok := raw["name"]; ok {
		var s string
		_ = json.Unmarshal(v, &s)
		in.Name = &s
	}
	if v, ok := raw["cpu"]; ok {
		var n int
		_ = json.Unmarshal(v, &n)
		in.CPU = &n
	}
	if v, ok := raw["memory_mb"]; ok {
		var n int
		_ = json.Unmarshal(v, &n)
		in.MemoryMB = &n
	}
	if v, ok := raw["traffic_gb"]; ok {
		var n int
		_ = json.Unmarshal(v, &n)
		in.TrafficGB = &n
	}
	if v, ok := raw["bandwidth_mbps"]; ok {
		var n int
		_ = json.Unmarshal(v, &n)
		in.BandwidthMbps = &n
	}
	if v, ok := raw["ports"]; ok {
		var n int
		_ = json.Unmarshal(v, &n)
		in.Ports = &n
	}
	if v, ok := raw["stock"]; ok {
		in.StockSet = true
		if string(v) != "null" {
			var n int
			_ = json.Unmarshal(v, &n)
			in.Stock = &n
		}
	}
	if v, ok := raw["enabled"]; ok {
		var b bool
		_ = json.Unmarshal(v, &b)
		in.Enabled = &b
	}
	if v, ok := raw["auto_start"]; ok {
		var b bool
		_ = json.Unmarshal(v, &b)
		in.AutoStart = &b
	}
	p, err := h.plans.Update(r.Context(), id, in)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *Handler) DeletePlan(w http.ResponseWriter, r *http.Request) {
	id, err := auth.ParseIDParam(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id 无效")
		return
	}
	if err := h.plans.Delete(r.Context(), id); err != nil {
		if errors.Is(err, plans.ErrNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
