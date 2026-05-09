import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { api, type Image, type IncusOperation } from "../lib/api";
import { Trash2, Download, X, Loader2 } from "lucide-react";
import { formatBytes } from "../lib/utils";

const SERVERS = [
  { label: "images.linuxcontainers.org", value: "https://images.linuxcontainers.org" },
  { label: "cloud-images.ubuntu.com", value: "https://cloud-images.ubuntu.com/releases" },
];

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

export default function ImagesPage() {
  const qc = useQueryClient();
  const [pullOpen, setPullOpen] = useState(false);

  const { data: operations = [] } = useQuery({
    queryKey: ["operations"],
    queryFn: api.operations.list,
    refetchInterval: 2000,
  });

  const pullOps = operations.filter((op) =>
    op.description.toLowerCase().includes("downloading image") ||
    op.description.toLowerCase().includes("pulling image") ||
    op.description.toLowerCase().includes("create image")
  );
  const pendingPullOps = pullOps.filter((op) => op.status === "Running");

  const { data: images = [], isLoading } = useQuery({
    queryKey: ["images"],
    queryFn: api.images.list,
    refetchInterval: pendingPullOps.length > 0 ? 2000 : false,
  });

  const deleteMutation = useMutation({
    mutationFn: (fp: string) => api.images.delete(fp),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["images"] });
      toast.success("镜像已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">镜像</h1>
        <button
          onClick={() => setPullOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Download className="w-4 h-4" />
          拉取镜像
        </button>
      </div>

      {pendingPullOps.length > 0 && (
        <div className="space-y-2">
          {pendingPullOps.map((op) => (
            <PullPendingRow key={op.id} op={op} />
          ))}
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">别名</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">架构</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">大小</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">指纹</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {images.map((img) => (
              <tr key={img.fingerprint} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3">{img.aliases.map((a) => a.name).join(", ") || "-"}</td>
                <td className="px-4 py-3 text-muted-foreground">{img.architecture}</td>
                <td className="px-4 py-3 text-muted-foreground">{img.type}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatBytes(img.size)}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {img.fingerprint.slice(0, 12)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      if (confirm("确认删除此镜像？")) deleteMutation.mutate(img.fingerprint);
                    }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {images.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">暂无本地镜像</div>
        )}
      </div>

      <PullImageDialog
        open={pullOpen}
        onOpenChange={setPullOpen}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["operations"] });
          qc.invalidateQueries({ queryKey: ["images"] });
        }}
      />
    </div>
  );
}

function PullPendingRow({ op }: { op: IncusOperation }) {
  return (
    <div className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-muted/20">
      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium">正在拉取镜像</span>
        <span className="text-xs text-muted-foreground ml-2">下载完成后将自动显示...</span>
      </div>
      <span className="text-xs text-muted-foreground font-mono">{op.id.slice(0, 8)}</span>
    </div>
  );
}

function PullImageDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const [alias, setAlias] = useState("");
  const [server, setServer] = useState(SERVERS[0].value);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const pullMutation = useMutation({
    mutationFn: () => api.images.pull(alias.trim(), server),
    onSuccess: () => {
      setSubmitted(true);
      onSuccess();
    },
    onError: (e: Error) => {
      setError(e.message);
      toast.error("拉取失败: " + e.message);
    },
  });

  function handleOpenChange(v: boolean) {
    if (!pullMutation.isPending) {
      setAlias("");
      setServer(SERVERS[0].value);
      setSubmitted(false);
      setError("");
      onOpenChange(v);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!alias.trim()) return setError("请输入镜像别名");
    pullMutation.mutate();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-card border border-border rounded-lg shadow-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">拉取镜像</Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </Dialog.Close>
          </div>

          {submitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <Loader2 className="w-4 h-4 text-blue-400 mt-0.5 animate-spin shrink-0" />
                <div className="text-sm space-y-1">
                  <p className="text-foreground font-medium">正在拉取镜像</p>
                  <p className="text-muted-foreground">下载进行中，完成后镜像列表将自动刷新。</p>
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
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">镜像别名</label>
                <input
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="例: ubuntu/24.04"
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">镜像服务器</label>
                <select
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  className={inputCls}
                >
                  {SERVERS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
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
                  disabled={pullMutation.isPending}
                  className="flex-1 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {pullMutation.isPending ? "提交中..." : "拉取"}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
