import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { api } from "../lib/api";
import { Plus, Trash2, X } from "lucide-react";

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

export default function NetworksPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: networks = [], isLoading } = useQuery({
    queryKey: ["networks"],
    queryFn: api.networks.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => api.networks.delete(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["networks"] });
      toast.success("网络已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">网络</h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          创建网络
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">名称</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">状态</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">托管</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">CIDR</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {networks.map((net) => (
              <tr key={net.name} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3 font-mono">{net.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{net.type}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs ${
                      net.status === "Created" ? "text-green-400" : "text-muted-foreground"
                    }`}
                  >
                    {net.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{net.managed ? "是" : "否"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {net.config["ipv4.address"] || "-"}
                </td>
                <td className="px-4 py-3 text-right">
                  {net.managed && (
                    <button
                      onClick={() => {
                        if (confirm(`确认删除网络 ${net.name}？`))
                          deleteMutation.mutate(net.name);
                      }}
                      disabled={deleteMutation.isPending}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {networks.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">暂无网络配置</div>
        )}
      </div>

      <CreateNetworkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["networks"] })}
      />
    </div>
  );
}

function CreateNetworkDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [cidr, setCidr] = useState("10.100.0.1/24");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: () => api.networks.create(name.trim(), cidr.trim()),
    onSuccess: () => {
      toast.success("网络已创建");
      onSuccess();
      onOpenChange(false);
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error("创建失败: " + e.message);
    },
  });

  function handleOpenChange(v: boolean) {
    if (!createMutation.isPending) {
      setName("");
      setCidr("10.100.0.1/24");
      setError("");
      onOpenChange(v);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("请输入网络名称");
    if (!cidr.trim()) return setError("请输入 IPv4 CIDR");
    createMutation.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">创建网络</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">网络名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="incusbr1"
                className={inputCls}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">IPv4 CIDR</label>
              <input
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder="10.100.0.1/24"
                className={inputCls}
              />
              <p className="text-xs text-muted-foreground">
                网桥 IP 地址，格式如 <code>10.x.x.1/24</code>，默认启用 NAT
              </p>
            </div>

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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
