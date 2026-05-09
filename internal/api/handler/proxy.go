package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type ProxyRule struct {
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	HostPort      int    `json:"host_port"`
	ContainerPort int    `json:"container_port"`
}

func parseProxyDevice(devName string, dev map[string]string) *ProxyRule {
	listen := dev["listen"]   // tcp:0.0.0.0:2222
	connect := dev["connect"] // tcp:127.0.0.1:22

	lp := strings.Split(listen, ":")
	cp := strings.Split(connect, ":")
	if len(lp) < 3 || len(cp) < 3 {
		return nil
	}
	hostPort, err1 := strconv.Atoi(lp[len(lp)-1])
	containerPort, err2 := strconv.Atoi(cp[len(cp)-1])
	if err1 != nil || err2 != nil {
		return nil
	}
	return &ProxyRule{
		Name:          devName,
		Protocol:      lp[0],
		HostPort:      hostPort,
		ContainerPort: containerPort,
	}
}

func (h *Handler) ListProxyRules(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	inst, _, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	rules := []ProxyRule{}
	for devName, dev := range inst.Devices {
		if dev["type"] != "proxy" {
			continue
		}
		if rule := parseProxyDevice(devName, dev); rule != nil {
			rules = append(rules, *rule)
		}
	}
	writeJSON(w, http.StatusOK, rules)
}

func (h *Handler) AddProxyRule(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req struct {
		HostPort      int    `json:"host_port"`
		ContainerPort int    `json:"container_port"`
		Protocol      string `json:"protocol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Protocol == "" {
		req.Protocol = "tcp"
	}
	if req.HostPort <= 0 || req.HostPort > 65535 || req.ContainerPort <= 0 || req.ContainerPort > 65535 {
		writeError(w, http.StatusBadRequest, "端口范围无效")
		return
	}

	inst, etag, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	put := inst.Writable()
	if put.Devices == nil {
		put.Devices = make(map[string]map[string]string)
	}
	devName := fmt.Sprintf("proxy-%d", req.HostPort)
	put.Devices[devName] = map[string]string{
		"type":    "proxy",
		"listen":  fmt.Sprintf("%s:0.0.0.0:%d", req.Protocol, req.HostPort),
		"connect": fmt.Sprintf("%s:127.0.0.1:%d", req.Protocol, req.ContainerPort),
	}
	op, err := h.client.Server().UpdateInstance(name, put, etag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) DeleteProxyRule(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	devName := chi.URLParam(r, "devname")

	inst, etag, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	put := inst.Writable()
	delete(put.Devices, devName)

	op, err := h.client.Server().UpdateInstance(name, put, etag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

// HostInfo 返回面板所在宿主机对外 IP（取请求的 Host header）
func (h *Handler) HostInfo(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if idx := strings.LastIndex(host, ":"); idx != -1 {
		host = host[:idx]
	}
	writeJSON(w, http.StatusOK, map[string]string{"ip": host})
}
