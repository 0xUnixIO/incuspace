BINARY   := incus-panel
BUILD_DIR := build
WEB_DIR   := web

.PHONY: all build build-web build-go dev dev-orb clean install

all: build

# 构建前端（bun build）
build-web:
	@echo ">> 构建前端..."
	cd $(WEB_DIR) && bun run build

# 构建后端
build-go:
	@echo ">> 构建后端..."
	go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY) ./cmd/incus-panel

# 完整构建（先前端后后端，前端产物嵌入 binary）
build: build-web build-go
	@echo ">> 产物: $(BUILD_DIR)/$(BINARY)"

# 开发模式（前后端分别启动）
dev:
	@echo ">> 启动开发服务器..."
	cd $(WEB_DIR) && bun run dev &
	go run ./cmd/incus-panel --addr :8080

# macOS 本地开发（OrbStack 里跑后端，macOS 跑前端）
dev-orb:
	@echo ">> 初始化 OrbStack 开发环境..."
	bash scripts/dev-setup.sh

# 清理
clean:
	rm -rf $(BUILD_DIR) web/node_modules internal/static/dist

# 安装到系统（需要 root）
install: build
	install -Dm755 $(BUILD_DIR)/$(BINARY) /usr/local/bin/$(BINARY)
	install -Dm644 systemd/incus-panel.service /etc/systemd/system/
	systemctl daemon-reload
	@echo ">> 安装完成，运行: systemctl enable --now incus-panel"
