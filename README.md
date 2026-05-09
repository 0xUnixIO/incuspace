# incuspace

基于 Web 的 [Incus](https://linuxcontainers.org/incus/) 容器与虚拟机管理面板，轻量级的自托管 Proxmox 替代方案。

![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/github/license/0xUnixIO/incuspace)
![Release](https://img.shields.io/github/v/release/0xUnixIO/incuspace)

## 功能

- **实例管理** — 创建、启动、停止、重启、删除容器和虚拟机
- **实时监控** — CPU、内存、网络 I/O 实时图表（2 秒轮询）
- **Web 控制台** — 基于 xterm.js 的全功能终端，支持窗口大小自适应
- **镜像管理** — 浏览本地镜像及远程镜像（images.linuxcontainers.org）
- **单文件部署** — 前端资源嵌入 Go 二进制，无额外依赖
- **JWT 认证** — 基于 Token 的鉴权，通过环境变量配置账号密码

## 一键安装

需要 Ubuntu 或 Debian，Incus 会由脚本自动安装。

```bash
curl -fsSL https://github.com/0xUnixIO/incuspace/releases/latest/download/install.sh | bash
```

脚本会自动完成：

1. 若未安装 Incus，通过 [zabbly 源](https://pkgs.zabbly.com/incus/stable)安装
2. 根据系统架构（amd64 / arm64）下载预编译二进制
3. 创建专用系统用户，生成随机密码并写入 `/opt/incuspace/.env`
4. 注册并启动 systemd 服务

安装完成后，访问地址和初始密码会打印到终端，密码同时保存在 `/opt/incuspace/.env`。

**自定义端口：**

```bash
PANEL_PORT=9090 curl -fsSL https://github.com/0xUnixIO/incuspace/releases/latest/download/install.sh | bash
```

## 手动安装

从 [Releases](https://github.com/0xUnixIO/incuspace/releases) 下载对应架构的二进制文件，然后：

```bash
mkdir -p /opt/incuspace
cat > /opt/incuspace/.env <<EOF
ADMIN_USER=admin
ADMIN_PASS=yourpassword
JWT_SECRET=$(openssl rand -base64 32)
EOF

./incuspace --addr :8080 --socket /var/lib/incus/unix.socket
```

## 开发

### 环境依赖

- [Go](https://go.dev/) 1.23+
- [Bun](https://bun.sh/) 1.x
- 运行在 Linux 宿主机上的 [Incus](https://linuxcontainers.org/incus/)

### macOS（OrbStack）

Incus 只能在 Linux 上运行。macOS 开发时，后端跑在 OrbStack VM 里，前端在宿主机：

```bash
make dev-orb
```

该命令会将后端交叉编译为 `linux/arm64`，复制到 OrbStack VM 并通过 `systemd-run` 启动，同时在本机启动 Bun 开发服务器（`localhost:5173`），API 请求代理到 VM。

### Linux

```bash
cd web && bun install  # 安装前端依赖

make dev               # 同时启动前端开发服务器和后端
```

- 前端开发服务器：`http://localhost:5173`
- 后端 API：`http://localhost:8080`

### 构建

```bash
make build      # 完整构建：前端编译 → 嵌入二进制 → build/incuspace
make build-web  # 仅构建前端
make build-go   # 仅构建后端（需先完成前端构建）
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADMIN_USER` | `admin` | 登录用户名 |
| `ADMIN_PASS` | `admin` | 登录密码 |
| `JWT_SECRET` | 随机生成 | JWT 签名密钥 |
| `STATIC_DIR` | 内嵌资源 | 覆盖静态文件路径（开发模式用） |

## 项目结构

```
cmd/incuspace/        # 程序入口，通过 go:embed 内嵌前端资源
internal/
  api/                # chi 路由与请求处理
  auth/               # JWT 中间件
  incus/              # Incus Unix socket 客户端
  static/             # 内嵌前端产物
web/src/
  pages/              # React 页面（实例、详情、控制台、镜像…）
  lib/api.ts          # 类型化 API 客户端
  dev-server.ts       # Bun 开发服务器（HTTP + WebSocket 代理）
```

构建流程：

```
bun run build  →  internal/static/dist/
go build       →  build/incuspace（包含内嵌的前端资源）
```

## 注意事项

- **虚拟机**需要宿主机支持 KVM（`/dev/kvm`），OrbStack VM 等嵌套虚拟化环境仅支持容器。
- Web 控制台通过 WebSocket 连接，JWT Token 以查询参数（`?token=...`）传递，因为浏览器的 WebSocket 不支持自定义请求头。

## License

MIT
