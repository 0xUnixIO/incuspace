package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	incusclient "github.com/lxc/incus/v6/client"
	incusapi "github.com/lxc/incus/v6/shared/api"
)

type Handler struct {
	client   *incus.Client
	upgrader websocket.Upgrader
}

func New(client *incus.Client) *Handler {
	return &Handler{
		client: client,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"message": msg})
}

// Login 用户名密码认证
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	adminUser := os.Getenv("ADMIN_USER")
	adminPass := os.Getenv("ADMIN_PASS")
	if adminUser == "" {
		adminUser = "admin"
	}
	if adminPass == "" {
		adminPass = "admin"
	}
	if req.Username != adminUser || req.Password != adminPass {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	token, err := auth.GenerateToken(req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token 生成失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (h *Handler) ListInstances(w http.ResponseWriter, r *http.Request) {
	instances, err := h.client.Server().GetInstances(incusapi.InstanceTypeAny)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, instances)
}

func (h *Handler) GetInstance(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	inst, _, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inst)
}

// PatchInstanceConfig 合并更新实例配置（只修改传入的字段，其余保留）
func (h *Handler) PatchInstanceConfig(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")

	inst, etag, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	var patch struct {
		Config      map[string]string `json:"config"`
		Description string            `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	put := inst.Writable()
	if patch.Description != "" {
		put.Description = patch.Description
	}
	for k, v := range patch.Config {
		if v == "" {
			delete(put.Config, k) // 空字符串表示删除该限制
		} else {
			put.Config[k] = v
		}
	}

	op, err := h.client.Server().UpdateInstance(name, put, etag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) CreateInstance(w http.ResponseWriter, r *http.Request) {
	var req incusapi.InstancesPost
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	op, err := h.client.Server().CreateInstance(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) DeleteInstance(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	op, err := h.client.Server().DeleteInstance(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) InstanceAction(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req struct {
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	state := incusapi.InstanceStatePut{Action: req.Action, Timeout: 30}
	op, err := h.client.Server().UpdateInstanceState(name, state, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) GetInstanceState(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	state, _, err := h.client.Server().GetInstanceState(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (h *Handler) ListImages(w http.ResponseWriter, r *http.Request) {
	images, err := h.client.Server().GetImages()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (h *Handler) DeleteImage(w http.ResponseWriter, r *http.Request) {
	fp := chi.URLParam(r, "fingerprint")
	op, err := h.client.Server().DeleteImage(fp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

// ListRemoteImages 搜索远程镜像（images.linuxcontainers.org）
func (h *Handler) ListRemoteImages(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
	if server == "" {
		server = "https://images.linuxcontainers.org"
	}
	imgServer, err := incusclient.ConnectSimpleStreams(server, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "连接远程镜像服务器失败: "+err.Error())
		return
	}
	images, err := imgServer.GetImages()
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (h *Handler) ListNetworks(w http.ResponseWriter, r *http.Request) {
	networks, err := h.client.Server().GetNetworks()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, networks)
}

func (h *Handler) ListStoragePools(w http.ResponseWriter, r *http.Request) {
	pools, err := h.client.Server().GetStoragePools()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pools)
}

func (h *Handler) ListOperations(w http.ResponseWriter, r *http.Request) {
	ops, err := h.client.Server().GetOperations()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ops)
}

// Console WebSocket 控制台：浏览器 ↔ 后端 ↔ Incus exec
func (h *Handler) Console(w http.ResponseWriter, r *http.Request) {
	// WS 无法设置 header，token 通过 query 参数传递
	token := r.URL.Query().Get("token")
	if _, err := auth.ValidateToken(token); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	name := chi.URLParam(r, "name")

	cols, _ := strconv.Atoi(r.URL.Query().Get("cols"))
	rows, _ := strconv.Atoi(r.URL.Query().Get("rows"))
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}

	browserConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer browserConn.Close()

	stdinR, stdinW := io.Pipe()
	stdout := &wsWriter{conn: browserConn}

	controlCh := make(chan *websocket.Conn, 1)

	execArgs := &incusclient.InstanceExecArgs{
		Stdin:  stdinR,
		Stdout: stdout,
		Stderr: stdout,
		Control: func(conn *websocket.Conn) {
			controlCh <- conn
		},
		DataDone: make(chan bool),
	}

	op, err := h.client.Server().ExecInstance(name, incusapi.InstanceExecPost{
		Command:     []string{"/bin/bash"},
		Environment: map[string]string{"TERM": "xterm-256color"},
		Interactive: true,
		WaitForWS:   true,
		Width:        cols,
		Height:       rows,
	}, execArgs)
	if err != nil {
		browserConn.WriteMessage(websocket.TextMessage, []byte(`{"error":"`+err.Error()+`"}`))
		return
	}

	var controlConn *websocket.Conn
	select {
	case controlConn = <-controlCh:
	case <-time.After(5 * time.Second):
	}

	// 从浏览器读取：binary = stdin，text = 控制消息（resize）
	go func() {
		defer stdinW.Close()
		for {
			msgType, msg, err := browserConn.ReadMessage()
			if err != nil {
				return
			}
			if msgType == websocket.TextMessage {
				var ctrl struct {
					Type string `json:"type"`
					Cols int    `json:"cols"`
					Rows int    `json:"rows"`
				}
				if json.Unmarshal(msg, &ctrl) == nil && ctrl.Type == "resize" && controlConn != nil {
					controlConn.WriteJSON(map[string]any{
						"command": "window-resize",
						"args":    map[string]int{"width": ctrl.Cols, "height": ctrl.Rows},
					})
				}
			} else {
				stdinW.Write(msg)
			}
		}
	}()

	op.Wait()
	<-execArgs.DataDone
}

// wsWriter 把 gorilla WebSocket 封装成 io.WriteCloser（线程安全）
type wsWriter struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (w *wsWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.conn.WriteMessage(websocket.BinaryMessage, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (w *wsWriter) Close() error { return nil }
