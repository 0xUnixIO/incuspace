import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, Plus, Key, Copy, Check } from "lucide-react";
import { api, type SSHKey } from "../lib/api";
import { cn } from "../lib/utils";

export default function SSHKeysPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["ssh-keys"],
    queryFn: api.sshKeys.list,
  });

  const addMutation = useMutation({
    mutationFn: () => api.sshKeys.add(name.trim(), publicKey.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh-keys"] });
      toast.success("SSH 公钥已添加");
      setName("");
      setPublicKey("");
      setShowForm(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.sshKeys.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ssh-keys"] });
      toast.success("已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCopy(key: SSHKey) {
    navigator.clipboard.writeText(key.public_key).then(() => {
      setCopiedId(key.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !publicKey.trim()) return;
    addMutation.mutate();
  }

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">SSH 公钥</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          添加公钥
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="border border-border rounded-lg p-4 space-y-3 bg-card"
        >
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: my-macbook"
              className={inputCls}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">公钥内容</label>
            <textarea
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="ssh-rsa AAAA... 或 ssh-ed25519 AAAA..."
              rows={4}
              className={cn(inputCls, "font-mono text-xs resize-none")}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-md text-muted-foreground hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending || !name.trim() || !publicKey.trim()}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {addMutation.isPending ? "添加中..." : "添加"}
            </button>
          </div>
        </form>
      )}

      {keys.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground text-sm space-y-2">
          <Key className="w-8 h-8 mx-auto opacity-30" />
          <p>暂无 SSH 公钥，创建实例时无法自动注入</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">名称</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">公钥</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">添加时间</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((key) => (
                <KeyRow
                  key={key.id}
                  sshKey={key}
                  copied={copiedId === key.id}
                  onCopy={() => handleCopy(key)}
                  onDelete={() => {
                    if (confirm(`确认删除公钥「${key.name}」？`)) {
                      deleteMutation.mutate(key.id);
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        添加的公钥可在创建实例时选择注入，通过 cloud-init 写入容器/虚拟机（需镜像支持 cloud-init）。
      </p>
    </div>
  );
}

function KeyRow({
  sshKey,
  copied,
  onCopy,
  onDelete,
}: {
  sshKey: SSHKey;
  copied: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const keyType = sshKey.public_key.split(" ")[0] ?? "";
  const keyPreview = sshKey.public_key.slice(-20);

  return (
    <tr className="hover:bg-accent/30 transition-colors">
      <td className="px-4 py-3 font-medium">{sshKey.name}</td>
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
        <span className="text-blue-400">{keyType}</span> …{keyPreview}
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs">
        {new Date(sshKey.created_at).toLocaleDateString("zh-CN")}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            title="复制公钥"
            onClick={onCopy}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            title="删除"
            onClick={onDelete}
            className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";
