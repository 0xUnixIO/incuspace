package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/0xUnixIO/incuspace/internal/auth"
	"github.com/0xUnixIO/incuspace/internal/images"
	"github.com/go-chi/chi/v5"
)

func (h *Handler) ListAllowedImages(w http.ResponseWriter, r *http.Request) {
	list, err := h.allowedImages.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (h *Handler) CreateAllowedImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Alias       string `json:"alias"`
		Source      string `json:"source"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if req.Alias == "" || req.Source == "" {
		writeError(w, http.StatusBadRequest, "alias/source 必填")
		return
	}
	img, err := h.allowedImages.Create(r.Context(), images.CreateInput{
		Alias: req.Alias, Source: req.Source, Description: req.Description,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, img)
}

func (h *Handler) DeleteAllowedImage(w http.ResponseWriter, r *http.Request) {
	id, err := auth.ParseIDParam(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "id 无效")
		return
	}
	if err := h.allowedImages.Delete(r.Context(), id); err != nil {
		if errors.Is(err, images.ErrNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
