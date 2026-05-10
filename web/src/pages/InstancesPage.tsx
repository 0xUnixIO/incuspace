import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { api, type Instance, type InstanceAction, type CreateInstanceRequest, type IncusOperation } from "../lib/api";
import { Play, Square, RotateCw, Trash2, Plus, Terminal, X, Loader2, KeyRound, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import { displayInstanceName } from "../lib/instance";

const statusColor: Record<string, string> = {
  Running: "bg-green-500/20 text-green-400 border-green-500/30",
  Stopped: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  Frozen: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Error: "bg-red-500/20 text-red-400 border-red-500/30",
  Creating: "bg-blue-500/20 text-blue-300 border-blue-500/30 animate-pulse",
};

export default function InstancesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: operations = [] } = useQuery({
    queryKey: ["operations"],
    queryFn: api.operations.list,
    refetchInterval: 2000,
  });

  const createOps = operations.filter(
    (op) => op.description.toLowerCase().includes("creating instance")
  );
  const pendingOps = createOps.filter((op) => op.status === "Running");
  const failedOps = createOps.filter((op) => op.status === "Failure" || op.status_code >= 400);

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ["instances"],
    queryFn: api.instances.list,
    // 有创建中的 operation 时加快轮询，尽快感知实例出现
    refetchInterval: pendingOps.length > 0 ? 2000 : 5000,
  });

  const actionMutation = useMutation({
    mutationFn: ({ name, action }: { name: string; action: InstanceAction }) =>
      api.instances.action(name, action),
    onSuccess: (_, { action }) => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success({ start: "启动", stop: "停止", restart: "重启" }[action] + " 指令已发送");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.instances.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("实例已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">加载中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">实例</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建实例
        </button>
      </div>

      {/* 进行中的创建操作 */}
      {(pendingOps.length > 0 || failedOps.length > 0) && (
        <div className="space-y-2">
          {pendingOps.map((op) => (
            <PendingOpRow key={op.id} op={op} />
          ))}
          {failedOps.map((op) => (
            <FailedOpRow key={op.id} op={op} />
          ))}
        </div>
      )}

      {instances.length === 0 && pendingOps.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm">
          暂无实例，点击右上角新建
        </div>
      ) : instances.length === 0 ? null : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">名称</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">状态</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">SSH</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">描述</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {instances.map((inst) => (
                <InstanceRow
                  key={inst.name}
                  instance={inst}
                  onDetail={() => navigate(`/instances/${inst.name}`)}
                  onAction={(action) => actionMutation.mutate({ name: inst.name, action })}
                  onDelete={() => {
                    if (confirm(`确认删除实例 ${inst.name}？`)) {
                      deleteMutation.mutate(inst.name);
                    }
                  }}
                  onConsole={() => navigate(`/instances/${inst.name}/console`)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateInstanceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          // 不立即关闭弹窗，弹窗内部显示"创建中"提示
          // 刷新 operations 让进度条出现
          qc.invalidateQueries({ queryKey: ["operations"] });
          qc.invalidateQueries({ queryKey: ["instances"] });
        }}
      />
    </div>
  );
}

// --- 创建实例弹窗 ---

function CreateInstanceDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState<string>("");
  const [image, setImage] = useState<string>("");
  const [error, setError] = useState("");

  const [submitted, setSubmitted] = useState(false);
  const [selectedKeyIDs, setSelectedKeyIDs] = useState<string[]>([]);

  const { data: sshKeys = [] } = useQuery({
    queryKey: ["ssh-keys"],
    queryFn: api.sshKeys.list,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["plans"],
    queryFn: api.plans.list,
    enabled: open,
  });

  const { data: images = [] } = useQuery({
    queryKey: ["allowed-images"],
    queryFn: api.allowedImages.list,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (req: CreateInstanceRequest) => api.instances.create(req),
    onSuccess: () => {
      toast.success("已提交创建，正在拉取镜像，列表会自动更新");
      onSuccess();
      // 直接重置并关闭，不走 handleOpenChange 的 isPending 守卫
      // （此时 isPending 在 React 状态尚未刷新前仍可能为 true）
      setName("");
      setPlanId("");
      setImage("");
      setError("");
      setSubmitted(false);
      setSelectedKeyIDs([]);
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error("创建失败: " + e.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("请输入实例名称");
    if (!planId) return setError("请选择套餐");
    if (!image) return setError("请选择镜像");

    createMutation.mutate({
      display_name: name.trim(),
      plan_id: planId,
      image,
      ssh_key_ids: selectedKeyIDs.length ? selectedKeyIDs : undefined,
    });
  }

  function handleOpenChange(v: boolean) {
    if (!createMutation.isPending) {
      setName("");
      setPlanId("");
      setImage("");
      setError("");
      setSubmitted(false);
      setSelectedKeyIDs([]);
      onOpenChange(v);
    }
  }

  function planAvailable(p: typeof plans[number]): boolean {
    if (!p.enabled) return false;
    if (p.stock != null && p.sold >= p.stock) return false;
    return true;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-card border border-border rounded-lg shadow-xl p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">新建实例</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <Loader2 className="w-4 h-4 text-blue-400 mt-0.5 animate-spin shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="text-foreground font-medium">实例创建中</p>
                  <p className="text-muted-foreground">正在从远程拉取镜像，首次创建可能需要几分钟，列表页面会自动更新。</p>
                </div>
              </div>
              <button
                onClick={() => handleOpenChange(false)}
                className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                知道了
              </button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 名称 */}
            <Field label="实例名称">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-container"
                className={inputCls}
                autoFocus
              />
            </Field>

            {/* 套餐选择 */}
            <Field label="套餐">
              {plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无可用套餐，请联系管理员</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {plans.map((p) => {
                    const available = planAvailable(p);
                    const selected = planId === p.id;
                    const stockLabel = p.stock == null ? "∞" : `${p.sold}/${p.stock}`;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!available}
                        onClick={() => setPlanId(p.id)}
                        className={cn(
                          "text-left p-3 rounded-md border transition-colors",
                          selected
                            ? "border-primary/60 bg-primary/10"
                            : "border-border hover:border-border/70",
                          !available && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground">{stockLabel}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          <div>{p.cpu} 核 · {p.memory_mb} MB</div>
                          <div>{p.traffic_gb} GB / 月 · {p.bandwidth_mbps} Mbps</div>
                          <div>{p.ports} 端口</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            {/* 镜像 */}
            <Field label="镜像">
              {images.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无可用镜像，请联系管理员</p>
              ) : (
                <select
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  className={inputCls}
                >
                  <option value="">请选择...</option>
                  {images.map((img) => (
                    <option key={img.id} value={img.alias}>
                      {img.alias}{img.description ? ` — ${img.description}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {/* SSH 公钥注入（可选）*/}
            {sshKeys.length > 0 && (
              <Field label="注入 SSH 公钥（可选）">
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {sshKeys.map((k) => {
                    const checked = selectedKeyIDs.includes(k.id);
                    return (
                      <label
                        key={k.id}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-2 rounded-md border cursor-pointer transition-colors text-sm",
                          checked
                            ? "border-primary/50 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={checked}
                          onChange={() =>
                            setSelectedKeyIDs((prev) =>
                              checked ? prev.filter((id) => id !== k.id) : [...prev, k.id]
                            )
                          }
                        />
                        <KeyRound className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{k.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">需镜像支持 cloud-init</p>
              </Field>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
                {error}
              </p>
            )}

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
                disabled={createMutation.isPending}
                className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? "创建中..." : "创建"}
              </button>
            </div>
          </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PendingOpRow({ op }: { op: IncusOperation }) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-muted/20">
      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">实例创建中</span>
        <span className="text-xs text-muted-foreground ml-2">正在拉取镜像，请稍候...</span>
      </div>
      <span className="text-xs text-muted-foreground font-mono">{op.id.slice(0, 8)}</span>
    </div>
  );
}

function FailedOpRow({ op }: { op: IncusOperation }) {
  return (
    <div className="flex items-start gap-3 border border-red-500/30 rounded-lg px-4 py-3 bg-red-500/5">
      <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-red-400">实例创建失败</span>
        {op.err && (
          <p className="text-xs text-muted-foreground mt-0.5 break-all">{op.err}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground font-mono shrink-0">{op.id.slice(0, 8)}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

// --- 实例行 ---

function InstanceRow({
  instance,
  onDetail,
  onAction,
  onDelete,
  onConsole,
}: {
  instance: Instance;
  onDetail: () => void;
  onAction: (a: InstanceAction) => void;
  onDelete: () => void;
  onConsole: () => void;
}) {
  const isRunning = instance.status === "Running";

  return (
    <tr className="hover:bg-accent/30 transition-colors">
      <td className="px-4 py-3">
        <button
          onClick={onDetail}
          className="font-mono font-medium hover:text-blue-400 transition-colors"
        >
          {displayInstanceName(instance.name)}
        </button>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {instance.type === "container" ? "容器" : "虚拟机"}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs border",
            statusColor[instance.status] ?? statusColor.Error
          )}
        >
          {instance.status}
        </span>
      </td>
      <td className="px-4 py-3">
        {instance.port_range_start ? (
          <SshQuickCell port={instance.port_range_start} />
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{instance.description || "-"}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {isRunning ? (
            <>
              <IconBtn title="控制台" onClick={onConsole}>
                <Terminal className="w-4 h-4" />
              </IconBtn>
              <IconBtn title="重启" onClick={() => onAction("restart")}>
                <RotateCw className="w-4 h-4" />
              </IconBtn>
              <IconBtn title="停止" onClick={() => onAction("stop")}>
                <Square className="w-4 h-4" />
              </IconBtn>
            </>
          ) : (
            <IconBtn title="启动" onClick={() => onAction("start")}>
              <Play className="w-4 h-4" />
            </IconBtn>
          )}
          <IconBtn title="删除" onClick={onDelete} danger>
            <Trash2 className="w-4 h-4" />
          </IconBtn>
        </div>
      </td>
    </tr>
  );
}

function SshQuickCell({ port }: { port: number }) {
  const cmd = `ssh root@${window.location.hostname} -p ${port}`;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(cmd);
        toast.success(`已复制：${cmd}`);
      }}
      className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
      title={cmd}
    >
      :{port}
      <Copy className="w-3 h-3" />
    </button>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        danger
          ? "text-muted-foreground hover:text-red-400 hover:bg-red-400/10"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
