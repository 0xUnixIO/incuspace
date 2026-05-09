import { useRef, useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { api, type InstanceState, type Snapshot } from "../lib/api";
import { formatBytes, formatPercent } from "../lib/utils";
import { ArrowLeft, Cpu, MemoryStick, Network, Terminal, Pencil, X, Plus, Trash2, RotateCw } from "lucide-react";

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
        <button
          onClick={() => navigate(`/instances/${name}/console`)}
          className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Terminal className="w-4 h-4" />
          控制台
        </button>
      </div>

      {/* 配置信息 */}
      {instance && (
        <div className="grid grid-cols-2 gap-4">
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
