# incuspace

A lightweight web UI for managing [Incus](https://linuxcontainers.org/incus/) containers and virtual machines — a self-hosted alternative to Proxmox for LXC workloads.

![Go](https://img.shields.io/badge/Go-1.23+-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/github/license/0xUnixIO/incuspace)
![Release](https://img.shields.io/github/v/release/0xUnixIO/incuspace)

## Features

- **Instance management** — create, start, stop, restart, delete containers and VMs
- **Real-time monitoring** — live CPU, memory, and network I/O charts (2s polling)
- **Web console** — full xterm.js terminal via WebSocket, with resize support
- **Image management** — browse local and remote images (images.linuxcontainers.org)
- **Single binary** — frontend embedded in the Go binary, no external dependencies
- **JWT auth** — token-based authentication, configurable via environment variables

## Quick Install

Requires Ubuntu or Debian with Incus already installed.

```bash
curl -fsSL https://github.com/0xUnixIO/incuspace/releases/latest/download/install.sh | bash
```

The script will:
1. Install Incus if not present (via [zabbly packages](https://pkgs.zabbly.com/incus/stable))
2. Download the pre-built binary for your architecture (amd64 / arm64)
3. Create a dedicated system user and `/opt/incuspace/.env` with a random password
4. Register and start a systemd service

After install, the access URL and credentials are printed to stdout. The password is also saved at `/opt/incuspace/.env`.

### Custom port

```bash
PANEL_PORT=9090 curl -fsSL https://github.com/0xUnixIO/incuspace/releases/latest/download/install.sh | bash
```

## Manual Install

Download a binary from [Releases](https://github.com/0xUnixIO/incuspace/releases), then:

```bash
# Create config
mkdir -p /opt/incuspace
cat > /opt/incuspace/.env <<EOF
ADMIN_USER=admin
ADMIN_PASS=yourpassword
JWT_SECRET=$(openssl rand -base64 32)
EOF

# Run
ADMIN_USER=admin ADMIN_PASS=yourpassword JWT_SECRET=... \
  ./incuspace --addr :8080 --socket /var/lib/incus/unix.socket
```

## Development

### Prerequisites

- [Go](https://go.dev/) 1.23+
- [Bun](https://bun.sh/) 1.x
- [Incus](https://linuxcontainers.org/incus/) running on a Linux host

### macOS (OrbStack)

Incus requires Linux. On macOS, run the backend inside an OrbStack VM and the frontend on the host:

```bash
make dev-orb
```

This cross-compiles the backend for `linux/arm64`, copies it into the OrbStack VM, starts it via `systemd-run`, and launches the Bun dev server on `localhost:5173` proxying API requests to the VM.

### Linux

```bash
# Install frontend deps
cd web && bun install

# Start both frontend dev server and backend
make dev
```

Frontend dev server: `http://localhost:5173`  
Backend API: `http://localhost:8080`

### Build

```bash
make build          # frontend → embedded → single binary in build/incuspace
make build-web      # frontend only
make build-go       # backend only (requires frontend already built)
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Login username |
| `ADMIN_PASS` | `admin` | Login password |
| `JWT_SECRET` | random | JWT signing secret |
| `STATIC_DIR` | embedded | Override static file path (dev mode) |

## Architecture

```
cmd/incuspace/        # entrypoint, embeds frontend via go:embed
internal/
  api/                # chi router + handlers
  auth/               # JWT middleware
  incus/              # Incus Unix socket client
  static/             # embedded frontend assets
web/src/
  pages/              # React pages (Instances, Detail, Console, Images, ...)
  lib/api.ts          # typed API client
  dev-server.ts       # Bun dev server with HTTP + WebSocket proxy
```

The binary embeds `internal/static/dist/` at compile time. The build pipeline is:

```
bun run build  →  internal/static/dist/
go build       →  build/incuspace  (includes embedded dist/)
```

## Notes

- **Virtual machines** require KVM (`/dev/kvm`) on the host. Nested virtualization environments (e.g., OrbStack VMs) only support containers.
- The web console connects via WebSocket. The JWT token is passed as a query parameter (`?token=...`) since browsers cannot set custom headers on WebSocket upgrades.

## License

MIT
