package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/sshkeys"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	incusclient "github.com/lxc/incus/v6/client"
	incusapi "github.com/lxc/incus/v6/shared/api"
)

type Handler struct {
	client   *incus.Client
	keys     *sshkeys.Store
	upgrader websocket.Upgrader
}

func New(client *incus.Client, keys *sshkeys.Store) *Handler {
	return &Handler{
		client: client,
		keys:   keys,
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
	var body struct {
		incusapi.InstancesPost
		SSHKeyIDs []string `json:"ssh_key_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req := body.InstancesPost
	if len(body.SSHKeyIDs) > 0 && h.keys != nil {
		if selected := h.keys.GetByIDs(body.SSHKeyIDs); len(selected) > 0 {
			if req.Config == nil {
				req.Config = make(map[string]string)
			}
			var sb strings.Builder
			sb.WriteString("#cloud-config\nssh_authorized_keys:\n")
			for _, k := range selected {
				sb.WriteString("  - ")
				sb.WriteString(strings.TrimSpace(k.PublicKey))
				sb.WriteString("\n")
			}
			req.Config["user.user-data"] = sb.String()
		}
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

// ---- 快照管理 ----

func (h *Handler) ListSnapshots(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	snaps, err := h.client.Server().GetInstanceSnapshots(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, snaps)
}

func (h *Handler) CreateSnapshot(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req incusapi.InstanceSnapshotsPost
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	op, err := h.client.Server().CreateInstanceSnapshot(name, req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

func (h *Handler) DeleteSnapshot(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	snap := chi.URLParam(r, "snap")
	op, err := h.client.Server().DeleteInstanceSnapshot(name, snap)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

// RestoreSnapshot 通过 PUT instance 的 Restore 字段恢复快照
func (h *Handler) RestoreSnapshot(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	snap := chi.URLParam(r, "snap")

	inst, etag, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	put := inst.Writable()
	put.Restore = snap
	op, err := h.client.Server().UpdateInstance(name, put, etag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

// ---- 镜像拉取 ----

// PullImage 从远程服务器拉取镜像到本地
func (h *Handler) PullImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Alias    string `json:"alias"`
		Server   string `json:"server"`
		Protocol string `json:"protocol"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Alias == "" {
		writeError(w, http.StatusBadRequest, "alias is required")
		return
	}
	if req.Server == "" {
		req.Server = "https://images.linuxcontainers.org"
	}
	if req.Protocol == "" {
		req.Protocol = "simplestreams"
	}

	imgPost := incusapi.ImagesPost{
		Source: &incusapi.ImagesPostSource{
			ImageSource: incusapi.ImageSource{
				Server:   req.Server,
				Protocol: req.Protocol,
				Alias:    req.Alias,
			},
			Type: "image",
			Mode: "pull",
		},
		Aliases: []incusapi.ImageAlias{{Name: req.Alias}},
	}

	op, err := h.client.Server().CreateImage(imgPost, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}

// ---- 网络管理 ----

func (h *Handler) CreateNetwork(w http.ResponseWriter, r *http.Request) {
	var req incusapi.NetworksPost
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Type == "" {
		req.Type = "bridge"
	}
	if err := h.client.Server().CreateNetwork(req); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": req.Name})
}

func (h *Handler) DeleteNetwork(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := h.client.Server().DeleteNetwork(name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- 文件管理 ----

// FileEntry 文件条目（列目录时返回）
type FileEntry struct {
	Name string `json:"name"`
	Type string `json:"type"` // "file" | "directory" | "symlink"
	Mode int    `json:"mode"`
}

// ListInstanceFiles 列出目录内容，并发 stat 每个条目获取类型
func (h *Handler) ListInstanceFiles(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	_, resp, err := h.client.Server().GetInstanceFile(name, path)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if resp.Type != "directory" {
		writeError(w, http.StatusBadRequest, "not a directory")
		return
	}

	type statResult struct {
		name string
		typ  string
		mode int
	}

	results := make([]statResult, len(resp.Entries))
	var wg sync.WaitGroup
	for i, entry := range resp.Entries {
		wg.Add(1)
		go func(i int, entry string) {
			defer wg.Done()
			entryPath := strings.TrimRight(path, "/") + "/" + entry
			_, er, err2 := h.client.Server().GetInstanceFile(name, entryPath)
			results[i].name = entry
			if err2 == nil && er != nil {
				results[i].typ = er.Type
				results[i].mode = er.Mode
			} else {
				results[i].typ = "file"
			}
		}(i, entry)
	}
	wg.Wait()

	entries := make([]FileEntry, len(results))
	for i, r := range results {
		entries[i] = FileEntry{Name: r.name, Type: r.typ, Mode: r.mode}
	}
	writeJSON(w, http.StatusOK, entries)
}

// DownloadInstanceFile 下载容器内文件，流式返回
func (h *Handler) DownloadInstanceFile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	reader, resp, err := h.client.Server().GetInstanceFile(name, filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if resp.Type == "directory" {
		writeError(w, http.StatusBadRequest, "cannot download a directory")
		return
	}
	defer reader.Close()

	filename := filePath[strings.LastIndex(filePath, "/")+1:]
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, reader)
}

// UploadInstanceFile 上传文件到容器，接受 multipart/form-data（字段名 file，目标路径通过 query path 传递）
func (h *Handler) UploadInstanceFile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	destPath := r.URL.Query().Get("path")
	if destPath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}

	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "parse form failed")
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field required")
		return
	}
	defer f.Close()

	err = h.client.Server().CreateInstanceFile(name, destPath, incusclient.InstanceFileArgs{
		Content:   f,
		Type:      "file",
		WriteMode: "overwrite",
		Mode:      0644,
		UID:       0,
		GID:       0,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": destPath})
}

// DeleteInstanceFile 删除容器内文件或目录
func (h *Handler) DeleteInstanceFile(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "path required")
		return
	}
	if err := h.client.Server().DeleteInstanceFile(name, filePath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
