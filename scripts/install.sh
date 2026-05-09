#!/bin/bash
set -euo pipefail

# Incus Panel 一键安装脚本
# 支持: Ubuntu 22.04+, Debian 12+

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

PANEL_VERSION="${PANEL_VERSION:-latest}"
PANEL_USER="incus-panel"
PANEL_DIR="/opt/incus-panel"
PANEL_PORT="${PANEL_PORT:-8080}"

# --- 检查权限 ---
[[ $EUID -ne 0 ]] && error "请以 root 运行此脚本"

# --- 检测发行版 ---
. /etc/os-release
info "检测到系统: $PRETTY_NAME"

case "$ID" in
  ubuntu|debian)
    PKG_MGR="apt-get"
    ;;
  *)
    error "暂不支持此发行版: $ID（仅支持 Ubuntu/Debian）"
    ;;
esac

# --- 安装 Incus ---
install_incus() {
  if command -v incus &>/dev/null; then
    info "Incus 已安装: $(incus version)"
    return
  fi
  info "安装 Incus..."
  $PKG_MGR update -qq
  $PKG_MGR install -y curl gnupg2

  # 添加 Zabbly 仓库（官方 Incus 包源）
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
  cat > /etc/apt/sources.list.d/zabbly-incus-stable.sources <<EOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: $(. /etc/os-release && echo $VERSION_CODENAME)
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly.asc
EOF

  $PKG_MGR update -qq
  $PKG_MGR install -y incus
  incus admin init --auto
  info "Incus 安装完成"
}

# --- 安装 incus-panel ---
install_panel() {
  info "安装 incus-panel..."

  # 下载预编译 binary（或从源码构建）
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH_TAG="amd64" ;;
    aarch64) ARCH_TAG="arm64" ;;
    *)       error "不支持的架构: $ARCH" ;;
  esac

  DOWNLOAD_URL="https://github.com/0xUnixIO/incus-panel/releases/download/${PANEL_VERSION}/incus-panel-linux-${ARCH_TAG}"
  mkdir -p "$PANEL_DIR"

  if [[ "$PANEL_VERSION" == "latest" ]] || ! curl -fsSL "$DOWNLOAD_URL" -o "$PANEL_DIR/incus-panel" 2>/dev/null; then
    warn "未找到预编译包，尝试从源码构建..."
    build_from_source
  else
    chmod +x "$PANEL_DIR/incus-panel"
  fi

  # 创建系统用户
  id -u "$PANEL_USER" &>/dev/null || useradd -r -s /bin/false "$PANEL_USER"
  usermod -aG incus-admin "$PANEL_USER" 2>/dev/null || true

  # 生成随机密码和 JWT secret
  ADMIN_PASS=$(openssl rand -base64 16)
  JWT_SECRET=$(openssl rand -base64 32)

  # 写入环境配置
  cat > "$PANEL_DIR/.env" <<EOF
ADMIN_USER=admin
ADMIN_PASS=${ADMIN_PASS}
JWT_SECRET=${JWT_SECRET}
EOF
  chmod 600 "$PANEL_DIR/.env"
  chown -R "$PANEL_USER:$PANEL_USER" "$PANEL_DIR"

  # 安装 systemd 服务
  cat > /etc/systemd/system/incus-panel.service <<EOF
[Unit]
Description=Incus Panel Web UI
After=network.target incus.socket
Requires=incus.socket

[Service]
Type=simple
User=${PANEL_USER}
EnvironmentFile=${PANEL_DIR}/.env
ExecStart=${PANEL_DIR}/incus-panel --addr :${PANEL_PORT} --socket /var/lib/incus/unix.socket
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now incus-panel
  info "incus-panel 安装完成"
}

build_from_source() {
  $PKG_MGR install -y git
  # 安装 Go
  if ! command -v go &>/dev/null; then
    GO_VER="1.23.0"
    curl -fsSL "https://go.dev/dl/go${GO_VER}.linux-${ARCH_TAG}.tar.gz" | tar -C /usr/local -xz
    export PATH="/usr/local/go/bin:$PATH"
  fi
  # 安装 Bun
  if ! command -v bun &>/dev/null; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi

  TMP=$(mktemp -d)
  git clone --depth 1 https://github.com/0xUnixIO/incus-panel "$TMP/incus-panel"
  cd "$TMP/incus-panel"
  make build
  cp build/incus-panel "$PANEL_DIR/incus-panel"
  chmod +x "$PANEL_DIR/incus-panel"
  rm -rf "$TMP"
}

# --- 主流程 ---
install_incus
install_panel

# --- 打印结果 ---
LOCAL_IP=$(hostname -I | awk '{print $1}')
ADMIN_PASS=$(grep ADMIN_PASS "$PANEL_DIR/.env" | cut -d= -f2)

echo ""
echo "============================================"
echo -e "  ${GREEN}Incus Panel 安装成功！${NC}"
echo "============================================"
echo "  访问地址: http://${LOCAL_IP}:${PANEL_PORT}"
echo "  用户名:   admin"
echo "  密码:     ${ADMIN_PASS}"
echo ""
echo "  密码已保存至: ${PANEL_DIR}/.env"
echo "============================================"
