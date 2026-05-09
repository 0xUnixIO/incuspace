#!/bin/bash
# OrbStack Ubuntu 开发环境一键初始化
# 在 macOS 交叉编译 Linux binary → 传到 OrbStack VM → VM 里跑 Incus + 后端
# 用法: bash scripts/dev-setup.sh
set -euo pipefail

MACHINE="incus-dev"
UNIT="incuspace-dev"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }

# --- 1. 确保 OrbStack Ubuntu 机器存在 ---
if ! orb run -m "$MACHINE" true 2>/dev/null; then
  info "创建 OrbStack Ubuntu 机器: $MACHINE ..."
  orb create ubuntu "$MACHINE"
  info "等待机器启动..."
  sleep 8
fi
info "机器 '$MACHINE' 已就绪"

# --- 2. 在 VM 里安装 Incus（只装一次，以 root 运行）---
info "检查 Incus..."
orb run -m "$MACHINE" -u root bash <<'EOF'
if command -v incus &>/dev/null; then
  echo "Incus 已安装: $(incus version)"
  exit 0
fi
echo "安装 Incus..."
apt-get update -qq
apt-get install -y curl gnupg2
mkdir -p /etc/apt/keyrings
curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
. /etc/os-release
cat > /etc/apt/sources.list.d/zabbly-incus-stable.sources <<SRCEOF
Enabled: yes
Types: deb
URIs: https://pkgs.zabbly.com/incus/stable
Suites: ${VERSION_CODENAME}
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/zabbly.asc
SRCEOF
apt-get update -qq
apt-get install -y incus
incus admin init --minimal
# --auto 在 OrbStack 里会因网段冲突失败，手动建网桥并指定固定子网
incus network create incusbr0 \
  ipv4.address=10.66.0.1/24 \
  ipv4.nat=true \
  ipv6.address=none 2>/dev/null || true
# 创建默认存储池并挂载根磁盘（--minimal 不会自动做这步）
incus storage create default dir 2>/dev/null || true
incus profile device add default root disk path=/ pool=default 2>/dev/null || true
# 创建网桥并挂到 default profile（新实例自动有网络）
incus network create incusbr0 ipv4.address=10.66.0.1/24 ipv4.nat=true ipv6.address=none 2>/dev/null || true
incus profile device add default eth0 nic nictype=bridged parent=incusbr0 name=eth0 2>/dev/null || true
echo "Incus 安装完成"
EOF

# --- 3. 在 macOS 交叉编译 Linux binary ---
GOARCH_TARGET=$(orb run -m "$MACHINE" uname -m | tr -d '\r' | sed 's/x86_64/amd64/;s/aarch64/arm64/')
info "交叉编译后端 (linux/${GOARCH_TARGET})..."
cd "$PROJECT_DIR"
GOOS=linux GOARCH="$GOARCH_TARGET" go build -ldflags="-s -w" -o "$HOME/incuspace-linux" ./cmd/incuspace
info "编译完成 → ~/incuspace-linux"

# --- 4. 停止旧进程 + 复制新 binary ---
info "部署 binary 到 VM..."
orb run -m "$MACHINE" -u root bash <<VMEOF
# 先停止 systemd unit，再 pkill 兜底
systemctl stop ${UNIT} 2>/dev/null || true
pkill -f incuspace 2>/dev/null || true
sleep 0.5
cp "/Users/$(whoami)/incuspace-linux" /tmp/incuspace
chmod +x /tmp/incuspace
VMEOF

# --- 5. 用 systemd-run 启动后端（会话结束后进程继续存活）---
info "启动后端..."
orb run -m "$MACHINE" -u root bash <<VMEOF
# 清理同名旧 unit（避免冲突）
systemctl stop ${UNIT} 2>/dev/null || true
systemctl reset-failed ${UNIT} 2>/dev/null || true

systemd-run \
  --unit=${UNIT} \
  --collect \
  --setenv=ADMIN_USER=admin \
  --setenv=ADMIN_PASS=admin \
  /tmp/incuspace --addr :8080

sleep 1
if ss -tlnp | grep -q ':8080'; then
  echo "后端已启动"
else
  echo "启动失败，日志："
  journalctl -u ${UNIT} -n 30 --no-pager
  exit 1
fi
VMEOF

# 获取 VM IP
VM_IP=$(orb run -m "$MACHINE" hostname -I | awk '{print $1}')
info "后端运行在: http://${VM_IP}:8080"

# --- 6. 启动前端（macOS，代理到 VM）---
info "启动前端开发服务器..."
cd "$PROJECT_DIR/web"
API_URL="http://${VM_IP}:8080" bun run dev &
FRONTEND_PID=$!

trap "kill $FRONTEND_PID 2>/dev/null; orb run -m $MACHINE -u root systemctl stop $UNIT 2>/dev/null; exit" INT TERM

echo ""
echo "============================================"
echo -e "  ${GREEN}开发环境就绪！${NC}"
echo "============================================"
echo "  前端:    http://localhost:5173"
echo "  后端:    http://${VM_IP}:8080"
echo "  账号:    admin / admin"
echo ""
echo "  后端日志: orb run -m $MACHINE -u root journalctl -u $UNIT -f"
echo "  Ctrl+C 停止所有服务"
echo "============================================"
wait $FRONTEND_PID
