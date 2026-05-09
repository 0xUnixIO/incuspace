/**
 * bun dev server - 替代 vite dev server
 * 支持：静态文件服务、HTTP API 代理、WebSocket 代理
 */
import { watch } from "fs";
import { join } from "path";

const OUT_DIR = join(import.meta.dir, "../../internal/static/dist");
const SRC_DIR = join(import.meta.dir);
const API_TARGET = process.env.API_URL ?? "http://localhost:8080";
const WS_TARGET = API_TARGET.replace(/^http/, "ws");

const TW_BIN = join(import.meta.dir, "../node_modules/.bin/tailwindcss");

async function buildCSS() {
  const proc = Bun.spawn([
    TW_BIN,
    "-i", join(SRC_DIR, "styles/globals.css"),
    "-o", join(SRC_DIR, "styles/built.css"),
  ]);
  await proc.exited;
}

async function build() {
  await buildCSS();
  const result = await Bun.build({
    entrypoints: [join(SRC_DIR, "main.tsx")],
    outdir: OUT_DIR,
    target: "browser",
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  if (!result.success) {
    console.error("Build failed:", result.logs);
  } else {
    await Bun.write(join(OUT_DIR, "index.html"), Bun.file(join(SRC_DIR, "index.html")));
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
  }
}

await build();

let debounce: Timer | null = null;
watch(SRC_DIR, { recursive: true }, (_, filename) => {
  if (filename?.endsWith(".css") || filename?.endsWith(".tsx") || filename?.endsWith(".ts")) {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(build, 150);
  }
});

// WebSocket 连接状态表
const wsMap = new Map<any, WebSocket>();

const server = Bun.serve({
  port: 5173,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket 升级：代理到后端
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket" && url.pathname.startsWith("/api/")) {
      const ok = server.upgrade(req, { data: { path: url.pathname + url.search } });
      if (ok) return;
    }

    // HTTP API 代理
    if (url.pathname.startsWith("/api/")) {
      const target = new URL(url.pathname + url.search, API_TARGET);
      return fetch(target.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    }

    // 静态文件
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(OUT_DIR, path));
    return file.exists().then((exists) =>
      exists
        ? new Response(file)
        : new Response(Bun.file(join(OUT_DIR, "index.html")))
    );
  },

  websocket: {
    open(ws) {
      const { path } = ws.data as { path: string };
      const backendUrl = WS_TARGET.replace(/\/$/, "") + path;
      const backend = new WebSocket(backendUrl);
      backend.binaryType = "arraybuffer";
      wsMap.set(ws, backend);

      backend.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          ws.sendBinary(new Uint8Array(e.data));
        } else {
          ws.send(e.data as string);
        }
      };
      backend.onclose = () => ws.close();
      backend.onerror = (e) => { console.error("backend ws error", e); ws.close(); };
    },
    message(ws, msg) {
      const backend = wsMap.get(ws);
      if (!backend || backend.readyState !== WebSocket.OPEN) return;
      if (typeof msg === "string") {
        backend.send(msg);
      } else {
        backend.send(msg);
      }
    },
    close(ws) {
      wsMap.get(ws)?.close();
      wsMap.delete(ws);
    },
  },
});

console.log(`dev server:  http://localhost:${server.port}`);
console.log(`api proxy →  ${API_TARGET}`);
