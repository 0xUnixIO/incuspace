package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/images"
	"github.com/0xUnixIO/incuspace/internal/incus"
	"github.com/0xUnixIO/incuspace/internal/instances"
	"github.com/0xUnixIO/incuspace/internal/plans"
	"github.com/0xUnixIO/incuspace/internal/quota"
	"github.com/0xUnixIO/incuspace/internal/sshkeys"
	"github.com/0xUnixIO/incuspace/internal/users"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	incusclient "github.com/lxc/incus/v6/client"
	incusapi "github.com/lxc/incus/v6/shared/api"
)

type Handler struct {
	client        *incus.Client
	keys          *sshkeys.Store
	quotas        *quota.Store
	users         *users.Repo
	insts         *instances.Repo
	plans         *plans.Repo
	allowedImages *images.Repo
	upgrader      websocket.Upgrader
}

func New(client *incus.Client, keys *sshkeys.Store, quotas *quota.Store,
	usersRepo *users.Repo, instsRepo *instances.Repo,
	plansRepo *plans.Repo, allowedImagesRepo *images.Repo) *Handler {
	return &Handler{
		client:        client,
		keys:          keys,
		quotas:        quotas,
		users:         usersRepo,
		insts:         instsRepo,
		plans:         plansRepo,
		allowedImages: allowedImagesRepo,
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

// Login 用户名密码认证（DB 比对）
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	u, err := h.users.Verify(r.Context(), req.Username, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	token, err := auth.GenerateToken(u.ID, u.Username, u.Role)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token 生成失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user":  u,
	})
}

// Me 返回当前登录用户
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	c := auth.FromContext(r.Context())
	if c == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	u, err := h.users.Get(r.Context(), c.UserID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "用户不存在")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (h *Handler) ListInstances(w http.ResponseWriter, r *http.Request) {
	c := auth.FromContext(r.Context())
	if c == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	all, err := h.client.Server().GetInstances(incusapi.InstanceTypeAny)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	incusByName := make(map[string]incusapi.Instance, len(all))
	for _, inst := range all {
		incusByName[inst.Name] = inst
	}

	// 以 DB 登记为准，缺失 Incus 数据时合成一个 status=Creating 的占位行，
	// 这样新建实例后即使 Incus 还没拉完镜像，列表也会立即出现。
	var owned []instances.Instance
	if auth.IsAdmin(c) {
		owned, err = h.insts.ListAll(r.Context())
	} else {
		owned, err = h.insts.ListByOwner(r.Context(), c.UserID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 包装为带 panel 元数据的结构
	type instanceWithMeta struct {
		incusapi.Instance
		PortRangeStart int `json:"port_range_start,omitempty"`
		PortRangeEnd   int `json:"port_range_end,omitempty"`
	}
	out := make([]instanceWithMeta, 0, len(owned))
	known := make(map[string]struct{}, len(owned))
	for _, o := range owned {
		known[o.Name] = struct{}{}
		var inst incusapi.Instance
		if existing, ok := incusByName[o.Name]; ok {
			inst = existing
		} else {
			inst = incusapi.Instance{
				InstancePut: incusapi.InstancePut{},
				Name:        o.Name,
				Status:      "Creating",
				StatusCode:  incusapi.Pending,
				Type:        "container",
				CreatedAt:   o.CreatedAt,
			}
		}
		out = append(out, instanceWithMeta{
			Instance:       inst,
			PortRangeStart: o.PortRangeStart,
			PortRangeEnd:   o.PortRangeEnd,
		})
	}
	// admin 还要附加：Incus 中存在但 DB 没登记的（如手动用 incus 命令创建的实例）
	if auth.IsAdmin(c) {
		for _, inst := range all {
			if _, ok := known[inst.Name]; !ok {
				out = append(out, instanceWithMeta{Instance: inst})
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
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

// GetInstancePanelInfo 返回面板登记的实例元数据（含端口范围、owner 等）+ 套餐快照
func (h *Handler) GetInstancePanelInfo(w http.ResponseWriter, r *http.Request) {
	inst := instanceFromCtx(r.Context())
	if inst == nil {
		writeError(w, http.StatusNotFound, "实例未在面板登记")
		return
	}
	resp := map[string]any{
		"id":               inst.ID,
		"name":             inst.Name,
		"display_name":     inst.DisplayName,
		"owner_id":         inst.OwnerID,
		"spec_cpu":         inst.SpecCPU,
		"spec_memory_mb":   inst.SpecMemoryMB,
		"port_range_start": inst.PortRangeStart,
		"port_range_end":   inst.PortRangeEnd,
		"plan_id":          inst.PlanID,
		"image":            inst.Image,
		"created_at":       inst.CreatedAt,
	}
	if inst.PlanID != nil && h.plans != nil {
		if p, err := h.plans.Get(r.Context(), *inst.PlanID); err == nil {
			resp["plan"] = p
		}
	}
	writeJSON(w, http.StatusOK, resp)
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
	c := auth.FromContext(r.Context())
	if c == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	if _, err := h.users.Get(r.Context(), c.UserID); err != nil {
		writeError(w, http.StatusUnauthorized, "用户不存在，请重新登录")
		return
	}
	var body struct {
		DisplayName string   `json:"display_name"`
		Name        string   `json:"name"` // 兼容旧字段；优先用 display_name
		PlanID      string   `json:"plan_id"`
		Image       string   `json:"image"` // alias
		SSHKeyIDs   []string `json:"ssh_key_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	displayName := body.DisplayName
	if displayName == "" {
		displayName = body.Name
	}
	if displayName == "" {
		writeError(w, http.StatusBadRequest, "实例名必填")
		return
	}
	if body.PlanID == "" {
		writeError(w, http.StatusBadRequest, "plan_id 必填")
		return
	}
	if body.Image == "" {
		writeError(w, http.StatusBadRequest, "image 必填")
		return
	}
	planID, err := auth.ParseIDParam(body.PlanID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "plan_id 无效")
		return
	}
	plan, err := h.plans.Get(r.Context(), planID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "套餐不存在")
		return
	}
	if !plan.Enabled {
		writeError(w, http.StatusBadRequest, "套餐已下架")
		return
	}
	if plan.Stock != nil && plan.Sold >= *plan.Stock {
		writeError(w, http.StatusConflict, "套餐已售罄")
		return
	}
	img, err := h.allowedImages.GetByAlias(r.Context(), body.Image)
	if err != nil {
		writeError(w, http.StatusBadRequest, "镜像不在允许列表")
		return
	}

	actualName := displayName
	if !auth.IsAdmin(c) {
		actualName = instances.PrefixedName(c.UserID, displayName)
	}

	// 构造 Incus 创建请求
	req := incusapi.InstancesPost{
		Name: actualName,
		Source: incusapi.InstanceSource{
			Type:     "image",
			Server:   "https://images.linuxcontainers.org",
			Protocol: "simplestreams",
			Alias:    img.Source,
		},
		InstancePut: incusapi.InstancePut{
			Config: map[string]string{
				"limits.cpu":    fmt.Sprintf("%d", plan.CPU),
				"limits.memory": fmt.Sprintf("%dMiB", plan.MemoryMB),
			},
		},
	}
	// 如果 source 看起来是完整的 server 形式（包含 ":"），更细的解析以后再加；MVP 默认用 linuxcontainers

	if len(body.SSHKeyIDs) > 0 && h.keys != nil {
		if selected := h.keys.GetByIDs(body.SSHKeyIDs); len(selected) > 0 {
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
	createdInst, err := h.insts.Create(r.Context(), instances.CreateInput{
		OwnerID:     c.UserID,
		DisplayName: displayName,
		Name:        actualName,
		CPU:         plan.CPU,
		MemoryMB:    plan.MemoryMB,
		Ports:       plan.Ports,
		PlanID:      &plan.ID,
		PlanStock:   plan.Stock,
		Image:       img.Alias,
	})
	if err != nil {
		_, _ = h.client.Server().DeleteInstance(actualName)
		writeError(w, http.StatusInternalServerError, "登记实例失败: "+err.Error())
		return
	}

	// 同步：套餐流量配额写入 DB（不依赖 Incus 实例存在）
	if h.quotas != nil && plan.TrafficGB > 0 {
		_ = h.quotas.Set(r.Context(), quota.Quota{
			InstanceID: createdInst.ID,
			LimitBytes: int64(plan.TrafficGB) * 1024 * 1024 * 1024,
			Period:     "monthly",
			Action:     "stop",
		})
	}

	// 异步：等 Incus 创建完成后应用带宽限速到主网卡 + 自动启动 + 默认 SSH proxy
	if plan.BandwidthMbps > 0 || plan.AutoStart {
		go h.applyBandwidthFromPlan(actualName, plan.BandwidthMbps, plan.AutoStart, createdInst.PortRangeStart, op)
	}

	writeJSON(w, http.StatusAccepted, op)
}

// applyBandwidthFromPlan 等 Incus 创建 op 完成后给主网卡设置 limits.ingress/egress；
// autoStart=true 时再启动实例并加默认 SSH proxy（host:sshHostPort → guest:22）。
func (h *Handler) applyBandwidthFromPlan(instanceName string, mbps int, autoStart bool, sshHostPort int, op incusclient.Operation) {
	if op != nil {
		if err := op.Wait(); err != nil {
			log.Printf("applyBandwidthFromPlan %s: op.Wait failed: %v", instanceName, err)
			return
		}
	}
	inst, etag, err := h.client.Server().GetInstance(instanceName)
	if err != nil {
		log.Printf("applyBandwidthFromPlan %s: GetInstance failed: %v", instanceName, err)
		return
	}
	nic := pickPrimaryNic(inst.ExpandedDevices)
	put := inst.Writable()
	if put.Devices == nil {
		put.Devices = make(map[string]map[string]string)
	}
	if mbps > 0 && nic != "" {
		dev := put.Devices[nic]
		if dev == nil {
			dev = make(map[string]string)
			for k, v := range inst.ExpandedDevices[nic] {
				dev[k] = v
			}
		}
		limit := fmt.Sprintf("%dMbit", mbps)
		dev["limits.ingress"] = limit
		dev["limits.egress"] = limit
		put.Devices[nic] = dev
	}
	// 默认 SSH proxy 设备：host:sshHostPort → guest:22
	if autoStart && sshHostPort > 0 {
		devName := fmt.Sprintf("proxy-%d", sshHostPort)
		if _, exists := put.Devices[devName]; !exists {
			put.Devices[devName] = map[string]string{
				"type":    "proxy",
				"listen":  fmt.Sprintf("tcp:0.0.0.0:%d", sshHostPort),
				"connect": "tcp:127.0.0.1:22",
			}
		}
	}
	if _, err := h.client.Server().UpdateInstance(instanceName, put, etag); err != nil {
		log.Printf("applyBandwidthFromPlan %s: UpdateInstance failed: %v", instanceName, err)
		return
	}
	log.Printf("applyBandwidthFromPlan %s: bandwidth=%dMbit sshPort=%d", instanceName, mbps, sshHostPort)

	if !autoStart {
		return
	}
	// 创建完成后自动启动
	startReq := incusapi.InstanceStatePut{Action: "start", Timeout: -1}
	startOp, err := h.client.Server().UpdateInstanceState(instanceName, startReq, "")
	if err != nil {
		log.Printf("autostart %s: UpdateInstanceState failed: %v", instanceName, err)
		return
	}
	if err := startOp.Wait(); err != nil {
		log.Printf("autostart %s: op.Wait failed: %v", instanceName, err)
		return
	}
	log.Printf("autostart %s: started", instanceName)
}

// ReconcilePlanLimits 启动时扫描 DB 中所有 plan_id != NULL 的实例，
// 若 Incus 实例存在但缺 limits.ingress/egress，则重新下发。
// 用于修复部署中断 / 老数据。
func (h *Handler) ReconcilePlanLimits(ctx context.Context) {
	log.Printf("reconcile: start")
	owned, err := h.insts.ListAll(ctx)
	if err != nil {
		log.Printf("reconcile: ListAll failed: %v", err)
		return
	}
	log.Printf("reconcile: scanning %d instances", len(owned))
	count := 0
	for _, o := range owned {
		if o.PlanID == nil {
			continue
		}
		plan, err := h.plans.Get(ctx, *o.PlanID)
		if err != nil || plan == nil {
			log.Printf("reconcile: %s plan lookup failed: %v", o.Name, err)
			continue
		}
		inst, _, err := h.client.Server().GetInstance(o.Name)
		if err != nil {
			log.Printf("reconcile: %s GetInstance failed: %v", o.Name, err)
			continue
		}
		nic := pickPrimaryNic(inst.ExpandedDevices)
		if nic == "" {
			log.Printf("reconcile: %s no nic", o.Name)
			continue
		}
		cur := inst.ExpandedDevices[nic]
		if cur["limits.ingress"] != "" && cur["limits.egress"] != "" {
			continue
		}
		log.Printf("reconcile: %s missing bandwidth, applying %dMbit", o.Name, plan.BandwidthMbps)
		count++
		go h.applyBandwidthFromPlan(o.Name, plan.BandwidthMbps, false, 0, nil)
	}
	log.Printf("reconcile: triggered %d apply tasks", count)
}

func (h *Handler) DeleteInstance(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	op, err := h.client.Server().DeleteInstance(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// DB 登记删除（best-effort，cascade 会带掉 quota）
	_ = h.insts.DeleteByName(r.Context(), name)
	writeJSON(w, http.StatusAccepted, op)
}

// parseMemoryMB 解析 incus limits.memory 字符串为 MB（粗略）
func parseMemoryMB(s string) int {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	// 支持后缀 KB/MB/GB/TB（二进制视为相同）
	var mult int = 1
	upper := strings.ToUpper(s)
	switch {
	case strings.HasSuffix(upper, "TB") || strings.HasSuffix(upper, "TIB"):
		mult = 1024 * 1024
		s = s[:len(s)-2]
	case strings.HasSuffix(upper, "GB") || strings.HasSuffix(upper, "GIB"):
		mult = 1024
		s = s[:len(s)-2]
	case strings.HasSuffix(upper, "MB") || strings.HasSuffix(upper, "MIB"):
		mult = 1
		s = s[:len(s)-2]
	case strings.HasSuffix(upper, "KB") || strings.HasSuffix(upper, "KIB"):
		// 不足 1MB 记 0
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return n * mult
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
		Width:       cols,
		Height:      rows,
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
