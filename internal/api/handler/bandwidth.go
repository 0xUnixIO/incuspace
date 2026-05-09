package handler

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

// Bandwidth 主网卡限速配置
type Bandwidth struct {
	NicName  string `json:"nic_name"`
	Ingress  string `json:"ingress"`  // 入站，例: "100Mbit" / "" 表示不限
	Egress   string `json:"egress"`   // 出站
	Priority string `json:"priority"` // 0-7，留空表示不设置
}

// 合法 limits 值：数字 + 单位 (bit/kbit/Mbit/Gbit/Tbit)
var bandwidthRe = regexp.MustCompile(`^\d+(?:\.\d+)?\s*(?:bit|kbit|Mbit|Gbit|Tbit)$`)

func devicesEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// pickPrimaryNic 从 expanded_devices 中挑出第一个 type=nic 的设备名
func pickPrimaryNic(expanded map[string]map[string]string) string {
	// 优先 eth0
	if d, ok := expanded["eth0"]; ok && d["type"] == "nic" {
		return "eth0"
	}
	// 否则取第一个
	for name, d := range expanded {
		if d["type"] == "nic" {
			return name
		}
	}
	return ""
}

func (h *Handler) GetBandwidth(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	inst, _, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	nic := pickPrimaryNic(inst.ExpandedDevices)
	if nic == "" {
		writeJSON(w, http.StatusOK, Bandwidth{})
		return
	}
	// 实例级 override 在 inst.Devices；如果没有 override 则继承自 profile（继承的不显示，只显示当前实例 override 的值）
	dev := inst.Devices[nic]
	out := Bandwidth{
		NicName:  nic,
		Ingress:  dev["limits.ingress"],
		Egress:   dev["limits.egress"],
		Priority: dev["limits.priority"],
	}
	writeJSON(w, http.StatusOK, out)
}

// PutBandwidth 写入主网卡的 limits.ingress / limits.egress / limits.priority
// 实现：在实例级 Devices 中以同名 NIC 写一个仅含 limits.* 的 override，覆盖 profile 继承的值。
func (h *Handler) PutBandwidth(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req Bandwidth
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	req.Ingress = strings.TrimSpace(req.Ingress)
	req.Egress = strings.TrimSpace(req.Egress)
	req.Priority = strings.TrimSpace(req.Priority)

	if req.Ingress != "" && !bandwidthRe.MatchString(req.Ingress) {
		writeError(w, http.StatusBadRequest, "ingress 格式无效，例: 100Mbit")
		return
	}
	if req.Egress != "" && !bandwidthRe.MatchString(req.Egress) {
		writeError(w, http.StatusBadRequest, "egress 格式无效，例: 100Mbit")
		return
	}
	if req.Priority != "" {
		if len(req.Priority) > 1 || req.Priority < "0" || req.Priority > "7" {
			writeError(w, http.StatusBadRequest, "priority 应为 0-7")
			return
		}
	}

	inst, etag, err := h.client.Server().GetInstance(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	nic := req.NicName
	if nic == "" {
		nic = pickPrimaryNic(inst.ExpandedDevices)
	}
	if nic == "" {
		writeError(w, http.StatusBadRequest, "未找到主网卡")
		return
	}

	put := inst.Writable()
	if put.Devices == nil {
		put.Devices = make(map[string]map[string]string)
	}
	dev := put.Devices[nic]
	if dev == nil {
		// 该 NIC 来自 profile 继承，没有实例级 override。
		// 拷贝 expanded 中的字段作为基底，避免某些 Incus 版本在缺少 type 字段时拒绝校验。
		dev = make(map[string]string)
		for k, v := range inst.ExpandedDevices[nic] {
			dev[k] = v
		}
	}

	setOrDelete := func(key, val string) {
		if val == "" {
			delete(dev, key)
		} else {
			dev[key] = val
		}
	}
	setOrDelete("limits.ingress", req.Ingress)
	setOrDelete("limits.egress", req.Egress)
	setOrDelete("limits.priority", req.Priority)

	// 如果没有任何 limits 且 dev 与 expanded 完全一致（纯继承），删除 override 让其完全继承
	hasLimits := dev["limits.ingress"] != "" || dev["limits.egress"] != "" || dev["limits.priority"] != ""
	if !hasLimits && devicesEqual(dev, inst.ExpandedDevices[nic]) {
		delete(put.Devices, nic)
	} else {
		put.Devices[nic] = dev
	}

	op, err := h.client.Server().UpdateInstance(name, put, etag)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, op)
}
