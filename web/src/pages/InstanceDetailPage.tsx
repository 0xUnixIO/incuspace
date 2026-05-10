import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { api, type InstanceState, type Snapshot, type SSHKey, type ProxyRule, type Bandwidth, type Quota, type QuotaPeriod, type QuotaAction } from "../lib/api";
import { formatBytes, formatPercent } from "../lib/utils";
import { cn } from "../lib/utils";
import { ArrowLeft, Cpu, MemoryStick, Network, Terminal, FolderOpen, Pencil, X, Plus, Trash2, RotateCw, KeyRound, Check, GitMerge, Copy, Gauge, AlertTriangle } from "lucide-react";

const MAX_POINTS = 60;
const INTERVAL_MS = 2000;

interface DataPoint {
  t: string;
  cpu: number;
  memUsed: number;
  memTotal: number;
  memPct: number;
  rxRate: number;
  txRate: number;
}

export default function InstanceDetailPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();

  const [points, setPoints] = useState<DataPoint[]>([]);
  const prevRef = useRef<{ cpuNs: number; rxBytes: number; txBytes: number; ts: number } | null>(null);
  const lastStateRef = useRef<InstanceState | null>(null);

  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [snapOpen, setSnapOpen] = useState(false);

  const { data: instance } = useQuery({
    queryKey: ["instance", name],
    queryFn: () => api.instances.get(name!),
  });

  const { data: panelInfo } = useQuery({
    queryKey: ["panel-info", name],
    queryFn: () => api.instances.panelInfo(name!),
    enabled: !!name,
    retry: false,
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ["snapshots", name],
    queryFn: () => api.instances.snapshots.list(name!),
    enabled: !!name,
  });

  const tick = useCallback(async () => {
    if (!name) return;
    let state: InstanceState;
    try {
      state = await api.instances.state(name);
    } catch {
      return;
    }
    if (state.status !== "Running") return;
    lastStateRef.current = state;

    const now = Date.now();
    const timeLabel = new Date().toLocaleTimeString("zh-CN", { hour12: false });

    let rxBytes = 0, txBytes = 0;
    for (const [iface, net] of Object.entries(state.network ?? {})) {
      if (iface === "lo") continue;
      rxBytes += net.counters.bytes_received;
      txBytes += net.counters.bytes_sent;
    }

    const prev = prevRef.current;
    let cpuPct = 0, rxRate = 0, txRate = 0;
    if (prev) {
      const dtMs = now - prev.ts;
      const dtNs = dtMs * 1_000_000;
      cpuPct = Math.min(((state.cpu.usage - prev.cpuNs) / dtNs) * 100, 100);
      rxRate = ((rxBytes - prev.rxBytes) / dtMs) * 1000;
      txRate = ((txBytes - prev.txBytes) / dtMs) * 1000;
    }
    prevRef.current = { cpuNs: state.cpu.usage, rxBytes, txBytes, ts: now };

    const memTotal = state.memory.total;
    const memUsed = state.memory.usage;

    setPoints((prev) => {
      const next = [
        ...prev,
        {
          t: timeLabel,
          cpu: parseFloat(cpuPct.toFixed(2)),
          memUsed,
          memTotal,
          memPct: memTotal > 0 ? parseFloat(((memUsed / memTotal) * 100).toFixed(2)) : 0,
          rxRate: parseFloat(rxRate.toFixed(0)),
          txRate: parseFloat(txRate.toFixed(0)),
        },
      ];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, [name]);

  useEffect(() => {
    tick();
    const id = setInterval(tick, INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const latest = points[points.length - 1];

  const cfg = instance?.expanded_config ?? instance?.config ?? {};
  const imageName = cfg["image.description"] ||
    `${cfg["image.os"] ?? ""} ${cfg["image.release"] ?? ""}`.trim() || "—";
  const arch = cfg["image.architecture"] || cfg["volatile.base_image"]?.slice(0, 8) || "—";

  const deleteSnapMutation = useMutation({
    mutationFn: (snap: string) => api.instances.snapshots.delete(name!, snap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshots", name] });
      toast.success("快照已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restoreSnapMutation = useMutation({
    mutationFn: (snap: string) => api.instances.snapshots.restore(name!, snap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance", name] });
      toast.success("已恢复到快照");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/instances")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold font-mono">{name}</h1>
            {instance && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {instance.type === "container" ? "容器" : "虚拟机"} · {instance.status}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/instances/${name}/files`)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            文件
          </button>
          <button
            onClick={() => navigate(`/instances/${name}/console`)}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Terminal className="w-4 h-4" />
            控制台
          </button>
        </div>
      </div>

      {/* 配置信息 */}
      {instance && (
        <div className={panelInfo?.plan ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : "grid grid-cols-2 gap-4"}>
          <InfoCard title="基本信息">
            <InfoRow label="名称" value={instance.name} mono />
            <InfoRow label="类型" value={instance.type === "container" ? "容器" : "虚拟机"} />
            <InfoRow label="状态" value={instance.status} />
            <InfoRow
              label="创建时间"
              value={new Date(instance.created_at).toLocaleString("zh-CN")}
            />
            <InfoRow
              label="Profiles"
              value={instance.profiles?.join(", ") || "default"}
              mono
            />
          </InfoCard>

          <InfoCard
            title="资源配置"
            action={
              <button
                onClick={() => setEditOpen(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            }
          >
            <InfoRow
              label="CPU 限制"
              value={instance.config?.["limits.cpu"] || "不限制"}
            />
            <InfoRow
              label="内存限制"
              value={instance.config?.["limits.memory"] || "不限制"}
            />
            <InfoRow
              label="架构"
              value={arch}
            />
            <InfoRow
              label="镜像"
              value={imageName}
            />
            <InfoRow
              label="IP 地址"
              value={<IpList state={lastStateRef.current} />}
            />
          </InfoCard>

          {panelInfo?.plan && (
            <InfoCard title="套餐">
              <InfoRow label="名称" value={panelInfo.plan.name} />
              <InfoRow
                label="规格"
                value={`${panelInfo.plan.cpu} 核 · ${panelInfo.plan.memory_mb} MB`}
              />
              <InfoRow
                label="月流量"
                value={`${panelInfo.plan.traffic_gb} GB`}
              />
              <InfoRow
                label="带宽"
                value={`${panelInfo.plan.bandwidth_mbps} Mbps`}
              />
              <InfoRow
                label="端口范围"
                value={
                  <span className="font-mono">
                    {panelInfo.port_range_start}–{panelInfo.port_range_end}
                  </span>
                }
              />
              <InfoRow
                label="SSH"
                value={
                  <SshHint
                    host={window.location.hostname}
                    port={panelInfo.port_range_start}
                  />
                }
              />
            </InfoCard>
          )}
        </div>
      )}

      {/* 实时指标卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          icon={<Cpu className="w-4 h-4" />}
          label="CPU"
          value={latest ? formatPercent(latest.cpu) : "—"}
          sub="使用率"
        />
        <MetricCard
          icon={<MemoryStick className="w-4 h-4" />}
          label="内存"
          value={latest ? formatPercent(latest.memPct) : "—"}
          sub={latest ? `${formatBytes(latest.memUsed)} / ${formatBytes(latest.memTotal)}` : "—"}
        />
        <MetricCard
          icon={<Network className="w-4 h-4" />}
          label="网络"
          value={latest ? `↓ ${formatBytes(latest.rxRate)}/s` : "—"}
          sub={latest ? `↑ ${formatBytes(latest.txRate)}/s` : "—"}
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 gap-4">
        <ChartCard title="CPU 使用率 (%)">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={tickStyle} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={tickStyle} />
              <Tooltip content={<CustomTooltip unit="%" />} />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fill="url(#gCpu)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="内存使用率 (%)">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={tickStyle} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={tickStyle} />
              <Tooltip content={<CustomTooltip unit="%" />} />
              <Area type="monotone" dataKey="memPct" stroke="#a855f7" fill="url(#gMem)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="网络 I/O (bytes/s)">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="t" tick={tickStyle} interval="preserveStartEnd" />
              <YAxis tick={tickStyle} tickFormatter={(v) => formatBytes(v)} />
              <Tooltip content={<NetworkTooltip />} />
              <Area type="monotone" dataKey="rxRate" name="下行" stroke="#22c55e" fill="url(#gRx)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="txRate" name="上行" stroke="#f59e0b" fill="url(#gTx)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* 网速 / 流量配额 */}
      <BandwidthPanel instanceName={name!} />
      <QuotaPanel instanceName={name!} />

      {/* 端口转发 */}
      <ProxyRulesPanel instanceName={name!} />

      {/* SSH 公钥 */}
      <InstanceSSHKeys instanceName={name!} />

      {/* 快照区域 */}
      <div className="border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-medium">快照</h3>
          <button
            onClick={() => setSnapOpen(true)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            创建快照
          </button>
        </div>

        {snapshots.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">暂无快照</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">名称</th>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">创建时间</th>
                <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">有状态</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {snapshots.map((snap) => (
                <tr key={snap.name} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">{snap.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(snap.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {snap.stateful ? "是" : "否"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="恢复"
                        onClick={() => {
                          if (confirm(`恢复将覆盖当前状态，确认恢复到快照 "${snap.name}"？`))
                            restoreSnapMutation.mutate(snap.name);
                        }}
                        disabled={restoreSnapMutation.isPending || deleteSnapMutation.isPending}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        <RotateCw className="w-4 h-4" />
                      </button>
                      <button
                        title="删除"
                        onClick={() => {
                          if (confirm(`确认删除快照 "${snap.name}"？`))
                            deleteSnapMutation.mutate(snap.name);
                        }}
                        disabled={deleteSnapMutation.isPending || restoreSnapMutation.isPending}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {instance && (
        <EditConfigDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          instanceName={name!}
          currentCpu={instance.config?.["limits.cpu"] ?? ""}
          currentMem={instance.config?.["limits.memory"] ?? ""}
          onSaved={() => qc.invalidateQueries({ queryKey: ["instance", name] })}
        />
      )}

      <CreateSnapshotDialog
        open={snapOpen}
        onOpenChange={setSnapOpen}
        instanceName={name!}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["snapshots", name] })}
      />
    </div>
  );
}

// --- 子组件 ---

function InfoCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm py-0.5">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`text-right break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function IpList({ state }: { state: InstanceState | null }) {
  if (!state?.network) return <span className="text-muted-foreground">—</span>;
  const ips: string[] = [];
  for (const [iface, net] of Object.entries(state.network)) {
    if (iface === "lo") continue;
    for (const addr of net.addresses ?? []) {
      if (addr.scope === "global") ips.push(`${addr.address} (${iface})`);
    }
  }
  if (ips.length === 0) return <span className="text-muted-foreground">无</span>;
  return <span className="font-mono text-xs">{ips.join(", ")}</span>;
}

function SshHint({ host, port }: { host: string; port: number }) {
  const cmd = `ssh root@${host} -p ${port}`;
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-xs">{cmd}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          toast.success("已复制 SSH 命令");
        }}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="复制"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-sm text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const tickStyle = { fontSize: 11, fill: "#64748b" };

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded px-2 py-1 text-xs">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-foreground font-medium">{payload[0].value}{unit}</p>
    </div>
  );
}

function NetworkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded px-2 py-1 text-xs space-y-1">
      <p className="text-muted-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatBytes(p.value)}/s
        </p>
      ))}
    </div>
  );
}

const inputCls = "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

function ProxyRulesPanel({ instanceName }: { instanceName: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [hostPort, setHostPort] = useState("");
  const [containerPort, setContainerPort] = useState("");
  const [protocol, setProtocol] = useState<"tcp" | "udp">("tcp");
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const { data: rules = [] } = useQuery<ProxyRule[]>({
    queryKey: ["proxy-rules", instanceName],
    queryFn: () => api.instances.proxyRules.list(instanceName),
  });

  // 实例的端口范围（来自面板登记），用于提示用户合法范围
  const { data: panelInfo } = useQuery({
    queryKey: ["panel-info", instanceName],
    queryFn: () => api.instances.panelInfo(instanceName),
    retry: false,
  });

  const { data: hostInfo } = useQuery({
    queryKey: ["host-info"],
    queryFn: api.hostInfo,
    staleTime: Infinity,
  });

  const hostIP = hostInfo?.ip ?? "<宿主机IP>";

  const addMutation = useMutation({
    mutationFn: () =>
      api.instances.proxyRules.add(instanceName, Number(hostPort), Number(containerPort), protocol),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proxy-rules", instanceName] });
      toast.success("端口转发已添加");
      setHostPort("");
      setContainerPort("");
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (devName: string) => api.instances.proxyRules.delete(instanceName, devName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proxy-rules", instanceName] });
      toast.success("已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function connCmd(rule: ProxyRule) {
    if (rule.container_port === 22 && rule.protocol === "tcp") {
      return `ssh -p ${rule.host_port} root@${hostIP}`;
    }
    return `${hostIP}:${rule.host_port} → 容器:${rule.container_port}`;
  }

  function handleCopy(cmd: string) {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd(null), 1500);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!hostPort || !containerPort) return;
    addMutation.mutate();
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">端口转发</h3>
          {panelInfo && panelInfo.port_range_start > 0 && (
            <span className="text-xs text-muted-foreground ml-2">
              可用范围 <span className="font-mono">{panelInfo.port_range_start}–{panelInfo.port_range_end}</span>
            </span>
          )}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加规则
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-border bg-muted/10 flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">宿主机端口</label>
            <input
              value={hostPort}
              onChange={(e) => setHostPort(e.target.value)}
              placeholder="2222"
              type="number"
              min={1}
              max={65535}
              className={cn(inputCls, "w-28")}
              autoFocus
            />
          </div>
          <div className="pb-0.5 text-muted-foreground text-sm">→</div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">容器端口</label>
            <input
              value={containerPort}
              onChange={(e) => setContainerPort(e.target.value)}
              placeholder="22"
              type="number"
              min={1}
              max={65535}
              className={cn(inputCls, "w-28")}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">协议</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as "tcp" | "udp")}
              className={cn(inputCls, "w-20")}
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={addMutation.isPending || !hostPort || !containerPort}
            className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {addMutation.isPending ? "..." : "添加"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="px-3 py-2 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
          >
            取消
          </button>
        </form>
      )}

      {rules.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          暂无端口转发规则
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">宿主机端口</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">容器端口</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">协议</th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">连接命令</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rules.map((rule) => {
              const cmd = connCmd(rule);
              const isCopied = copiedCmd === cmd;
              return (
                <tr key={rule.name} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-mono font-medium">{rule.host_port}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{rule.container_port}</td>
                  <td className="px-4 py-3 text-muted-foreground uppercase text-xs">{rule.protocol}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleCopy(cmd)}
                      title="复制"
                      className="flex items-center gap-1.5 font-mono text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {isCopied
                        ? <Check className="w-3.5 h-3.5 text-green-400" />
                        : <Copy className="w-3.5 h-3.5" />}
                      <span>{cmd}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        if (confirm(`确认删除端口 ${rule.host_port} 的转发规则？`))
                          deleteMutation.mutate(rule.name);
                      }}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function InstanceSSHKeys({ instanceName }: { instanceName: string }) {
  const qc = useQueryClient();

  const { data: storeKeys = [] } = useQuery<SSHKey[]>({
    queryKey: ["ssh-keys"],
    queryFn: api.sshKeys.list,
  });

  const { data: instanceKeyLines = [], isLoading } = useQuery<string[]>({
    queryKey: ["instance-ssh-keys", instanceName],
    queryFn: () => api.instances.sshKeys.get(instanceName),
  });

  // 面板 key 是否已在实例中（按公钥内容比对）
  function isApplied(key: SSHKey) {
    return instanceKeyLines.some((line) => line.trim() === key.public_key.trim());
  }

  const [selected, setSelected] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // 初始化勾选状态：把当前 instance 中已有的面板 key 勾上
  useEffect(() => {
    if (!initialized && storeKeys.length > 0 && !isLoading) {
      setSelected(storeKeys.filter(isApplied).map((k) => k.id));
      setInitialized(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKeys, instanceKeyLines, isLoading]);

  const applyMutation = useMutation({
    mutationFn: () => api.instances.sshKeys.set(instanceName, selected),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instance-ssh-keys", instanceName] });
      toast.success("SSH 公钥已更新");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">SSH 公钥</h3>
        </div>
        <button
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          {applyMutation.isPending ? "应用中..." : "应用"}
        </button>
      </div>

      {storeKeys.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          面板中还没有 SSH 公钥，请先到「SSH 公钥」页面添加
        </div>
      ) : (
        <div className="divide-y divide-border">
          {storeKeys.map((key) => {
            const checked = selected.includes(key.id);
            const applied = isApplied(key);
            return (
              <label
                key={key.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-accent/20",
                  checked && "bg-primary/5"
                )}
              >
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={checked}
                  onChange={() =>
                    setSelected((prev) =>
                      checked ? prev.filter((id) => id !== key.id) : [...prev, key.id]
                    )
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{key.name}</span>
                    {applied && (
                      <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded">
                        已在实例中
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground truncate mt-0.5">
                    {key.public_key.slice(0, 60)}…
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditConfigDialog({
  open, onOpenChange, instanceName, currentCpu, currentMem, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instanceName: string;
  currentCpu: string;
  currentMem: string;
  onSaved: () => void;
}) {
  const [cpu, setCpu] = useState(currentCpu);
  const [mem, setMem] = useState(currentMem);

  useEffect(() => {
    if (open) { setCpu(currentCpu); setMem(currentMem); }
  }, [open, currentCpu, currentMem]);

  const mutation = useMutation({
    mutationFn: () =>
      api.instances.updateConfig(instanceName, {
        "limits.cpu": cpu.trim(),
        "limits.memory": mem.trim(),
      }),
    onSuccess: () => {
      toast.success("配置已更新");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">编辑资源配置</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">CPU 限制</label>
              <input
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
                placeholder="留空表示不限制，例: 2"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">填写核数（如 <code>2</code>）或核心范围（如 <code>0-1</code>）</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">内存限制</label>
              <input
                value={mem}
                onChange={(e) => setMem(e.target.value)}
                placeholder="留空表示不限制，例: 512MB"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">支持 MB / GB 单位，如 <code>512MB</code>、<code>2GB</code></p>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Dialog.Close asChild>
              <button className="flex-1 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateSnapshotDialog({
  open,
  onOpenChange,
  instanceName,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instanceName: string;
  onSuccess: () => void;
}) {
  const [snapName, setSnapName] = useState("");

  function handleOpenChange(v: boolean) {
    if (!mutation.isPending) {
      setSnapName("");
      onOpenChange(v);
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const finalName = snapName.trim() || new Date().toISOString().replace(/[:.]/g, "-");
      return api.instances.snapshots.create(instanceName, finalName);
    },
    onSuccess: () => {
      toast.success("快照已创建");
      onSuccess();
      handleOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">创建快照</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">快照名称</label>
              <input
                value={snapName}
                onChange={(e) => setSnapName(e.target.value)}
                placeholder="留空则使用时间戳"
                className={inputCls}
                autoFocus
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="flex-1 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  取消
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {mutation.isPending ? "创建中..." : "创建"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- 网速限制 ---

function BandwidthPanel({ instanceName }: { instanceName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<Bandwidth>({
    queryKey: ["bandwidth", instanceName],
    queryFn: () => api.instances.bandwidth.get(instanceName),
  });

  const has = !!(data?.ingress || data?.egress || data?.priority);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">网速限制</h3>
          {data?.nic_name && (
            <span className="text-xs text-muted-foreground font-mono">({data.nic_name})</span>
          )}
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
          编辑
        </button>
      </div>
      <div className="px-4 py-3 grid grid-cols-3 gap-4 text-sm">
        <BwItem label="入站 (ingress)" value={data?.ingress} />
        <BwItem label="出站 (egress)" value={data?.egress} />
        <BwItem label="优先级 (0-7)" value={data?.priority} />
      </div>
      {!has && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          未限速。修改后会立即对实例生效（运行中也无需重启）。
        </div>
      )}
      <BandwidthDialog
        open={open}
        onOpenChange={setOpen}
        instanceName={instanceName}
        current={data}
        onSaved={() => qc.invalidateQueries({ queryKey: ["bandwidth", instanceName] })}
      />
    </div>
  );
}

function BwItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono">{value || <span className="text-muted-foreground">不限</span>}</div>
    </div>
  );
}

function BandwidthDialog({
  open, onOpenChange, instanceName, current, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instanceName: string;
  current?: Bandwidth;
  onSaved: () => void;
}) {
  const [ingress, setIngress] = useState("");
  const [egress, setEgress] = useState("");
  const [priority, setPriority] = useState("");

  useEffect(() => {
    if (open) {
      setIngress(current?.ingress ?? "");
      setEgress(current?.egress ?? "");
      setPriority(current?.priority ?? "");
    }
  }, [open, current]);

  const mutation = useMutation({
    mutationFn: () =>
      api.instances.bandwidth.put(instanceName, {
        nic_name: current?.nic_name ?? "",
        ingress: ingress.trim(),
        egress: egress.trim(),
        priority: priority.trim(),
      }),
    onSuccess: () => {
      toast.success("网速限制已更新");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">编辑网速限制</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">入站 (ingress)</label>
              <input
                value={ingress}
                onChange={(e) => setIngress(e.target.value)}
                placeholder="留空不限，例: 100Mbit"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">出站 (egress)</label>
              <input
                value={egress}
                onChange={(e) => setEgress(e.target.value)}
                placeholder="留空不限，例: 50Mbit"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">支持单位 <code>bit / kbit / Mbit / Gbit</code></p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">优先级</label>
              <input
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                placeholder="留空不设置，0-7（数字越大越优先）"
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Dialog.Close asChild>
              <button className="flex-1 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- 流量配额 ---

const GIB = 1024 * 1024 * 1024;

function QuotaPanel({ instanceName }: { instanceName: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<Quota>({
    queryKey: ["quota", instanceName],
    queryFn: () => api.instances.quota.get(instanceName),
    refetchInterval: 10_000,
  });

  const enabled = !!data?.enabled;
  const used = data?.used_bytes ?? 0;
  const limit = data?.limit_bytes ?? 0;
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  const reset = useMutation({
    mutationFn: () => api.instances.quota.reset(instanceName),
    onSuccess: () => {
      toast.success("用量已重置");
      qc.invalidateQueries({ queryKey: ["quota", instanceName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api.instances.quota.delete(instanceName),
    onSuccess: () => {
      toast.success("配额已移除");
      qc.invalidateQueries({ queryKey: ["quota", instanceName] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">流量配额</h3>
          {enabled && data?.triggered && (
            <span className="flex items-center gap-1 text-xs bg-red-500/15 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded">
              <AlertTriangle className="w-3 h-3" />
              已触发
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {enabled && (
            <>
              <button
                onClick={() => reset.mutate()}
                disabled={reset.isPending}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                <RotateCw className="w-3.5 h-3.5" />
                重置用量
              </button>
              <button
                onClick={() => {
                  if (confirm("确认移除流量配额？")) remove.mutate();
                }}
                disabled={remove.isPending}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                移除
              </button>
            </>
          )}
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {enabled ? "编辑" : "设置配额"}
          </button>
        </div>
      </div>

      {enabled ? (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-baseline justify-between">
            <div className="text-2xl font-semibold tabular-nums">
              {formatBytes(used)} <span className="text-sm text-muted-foreground">/ {limit === 0 ? "∞" : formatBytes(limit)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {data?.period === "monthly" ? "每月重置" : "累计"} · 超额{actionLabel(data?.action)}
            </div>
          </div>
          {limit > 0 && (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-blue-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            最后采样: {data?.last_poll_at ? new Date(data.last_poll_at).toLocaleString("zh-CN") : "—"}
          </div>
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          未设置配额。设置后由面板每 30 秒采样一次累计流量，超额可自动停机。
        </div>
      )}

      <QuotaDialog
        open={open}
        onOpenChange={setOpen}
        instanceName={instanceName}
        current={data}
        onSaved={() => qc.invalidateQueries({ queryKey: ["quota", instanceName] })}
      />
    </div>
  );
}

function actionLabel(a?: QuotaAction): string {
  switch (a) {
    case "stop": return "停机";
    case "freeze": return "冻结";
    case "notify": return "仅记录";
    default: return "停机";
  }
}

function QuotaDialog({
  open, onOpenChange, instanceName, current, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instanceName: string;
  current?: Quota;
  onSaved: () => void;
}) {
  const [limitGB, setLimitGB] = useState("100");
  const [period, setPeriod] = useState<QuotaPeriod>("monthly");
  const [action, setAction] = useState<QuotaAction>("stop");

  useEffect(() => {
    if (!open) return;
    if (current?.enabled) {
      setLimitGB(((current.limit_bytes || 0) / GIB).toString());
      setPeriod(current.period);
      setAction(current.action);
    } else {
      setLimitGB("100");
      setPeriod("monthly");
      setAction("stop");
    }
  }, [open, current]);

  const mutation = useMutation({
    mutationFn: () => {
      const gb = parseFloat(limitGB);
      if (isNaN(gb) || gb < 0) throw new Error("配额必须是非负数字");
      return api.instances.quota.set(instanceName, Math.round(gb * GIB), period, action);
    },
    onSuccess: () => {
      toast.success("流量配额已保存");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">流量配额</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">配额 (GB)</label>
              <input
                value={limitGB}
                onChange={(e) => setLimitGB(e.target.value)}
                placeholder="0 表示不限"
                inputMode="decimal"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">统计 ↑↑ 出 + ↓↓ 入 总和（不含 lo 接口）</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">周期</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as QuotaPeriod)}
                className={inputCls}
              >
                <option value="monthly">每月（自然月 1 号清零）</option>
                <option value="total">累计（不重置）</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">超额动作</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as QuotaAction)}
                className={inputCls}
              >
                <option value="stop">停机（force stop）</option>
                <option value="freeze">冻结（freeze）</option>
                <option value="notify">仅记录</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Dialog.Close asChild>
              <button className="flex-1 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
                取消
              </button>
            </Dialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
