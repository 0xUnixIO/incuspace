package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	incusclient "github.com/lxc/incus/v6/client"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListSSHKeys(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.keys.List())
}

func (h *Handler) AddSSHKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		PublicKey string `json:"public_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.PublicKey = strings.TrimSpace(req.PublicKey)
	if req.Name == "" || req.PublicKey == "" {
		writeError(w, http.StatusBadRequest, "name 和 public_key 不能为空")
		return
	}
	k, err := h.keys.Add(req.Name, req.PublicKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, k)
}

func (h *Handler) DeleteSSHKey(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.keys.Delete(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetInstanceSSHKeys 读取实例 /root/.ssh/authorized_keys，返回 key 行列表
func (h *Handler) GetInstanceSSHKeys(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	reader, resp, err := h.client.Server().GetInstanceFile(name, "/root/.ssh/authorized_keys")
	if err != nil {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	if resp.Type == "directory" {
		writeJSON(w, http.StatusOK, []string{})
		return
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var keys []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "#") {
			keys = append(keys, line)
		}
	}
	writeJSON(w, http.StatusOK, keys)
}

// PutInstanceSSHKeys 用面板中选择的公钥覆写实例的 authorized_keys
func (h *Handler) PutInstanceSSHKeys(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req struct {
		KeyIDs []string `json:"key_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}

	var sb strings.Builder
	if len(req.KeyIDs) > 0 && h.keys != nil {
		for _, k := range h.keys.GetByIDs(req.KeyIDs) {
			sb.WriteString(strings.TrimSpace(k.PublicKey))
			sb.WriteString("\n")
		}
	}
	content := sb.String()

	// 确保 .ssh 目录存在（忽略错误，目录可能已存在）
	_ = h.client.Server().CreateInstanceFile(name, "/root/.ssh", incusclient.InstanceFileArgs{
		Type: "directory",
		Mode: 0700,
		UID:  0,
		GID:  0,
	})

	err := h.client.Server().CreateInstanceFile(name, "/root/.ssh/authorized_keys", incusclient.InstanceFileArgs{
		Content:   strings.NewReader(content),
		Type:      "file",
		WriteMode: "overwrite",
		Mode:      0600,
		UID:       0,
		GID:       0,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
