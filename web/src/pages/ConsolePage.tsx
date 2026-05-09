import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ArrowLeft } from "lucide-react";

export default function ConsolePage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current || !name) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        brightBlack: "#6e7681",
        red: "#ff7b72",
        brightRed: "#ffa198",
        green: "#3fb950",
        brightGreen: "#56d364",
        yellow: "#d29922",
        brightYellow: "#e3b341",
        blue: "#58a6ff",
        brightBlue: "#79c0ff",
        magenta: "#bc8cff",
        brightMagenta: "#d2a8ff",
        cyan: "#39c5cf",
        brightCyan: "#56d4dd",
        white: "#b1bac4",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // 建立 WebSocket 连接（token 通过 query 传递，WS 不支持自定义 header）
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("token") ?? "";
    const { cols, rows } = term;
    const ws = new WebSocket(
      `${proto}//${window.location.host}/api/v1/instances/${name}/console?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`
    );
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln("\r\n\x1b[32m已连接到实例控制台\x1b[0m\r\n");
      fitAddon.fit();
    };

    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      }
    };

    ws.onerror = () => term.writeln("\r\n\x1b[31m连接错误\x1b[0m");
    ws.onclose = () => term.writeln("\r\n\x1b[33m连接已断开\x1b[0m");

    // 终端输入 → WebSocket（必须用 binary frame，text frame 被后端用于 resize 控制消息）
    const encoder = new TextEncoder();
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encoder.encode(data));
      }
    });

    // 窗口 resize → 通知后端
    const fitAndResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      ws.close();
      term.dispose();
    };
  }, [name]);

  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#21262d] bg-[#161b22] shrink-0">
        <button
          onClick={() => navigate(`/instances/${name}`)}
          className="text-[#8b949e] hover:text-[#c9d1d9] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm text-[#8b949e]">控制台</span>
        <span className="text-sm font-mono text-[#58a6ff]">{name}</span>
        <span className="ml-auto text-xs text-[#6e7681]">Ctrl+D 退出</span>
      </div>

      {/* 终端容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-2"
        style={{ minHeight: 0 }}
      />
    </div>
  );
}
