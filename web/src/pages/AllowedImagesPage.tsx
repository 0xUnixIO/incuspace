import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

const PRESETS = [
  { label: "Ubuntu 24.04", alias: "ubuntu-2404", source: "ubuntu/24.04" },
  { label: "Ubuntu 22.04", alias: "ubuntu-2204", source: "ubuntu/22.04" },
  { label: "Debian 12", alias: "debian-12", source: "debian/12" },
  { label: "Alpine 3.20", alias: "alpine-320", source: "alpine/3.20" },
  { label: "OpenWrt 23.05", alias: "openwrt-2305", source: "openwrt/23.05" },
];

export default function AllowedImagesPage() {
  const qc = useQueryClient();
  const [alias, setAlias] = useState("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");

  const { data: images = [], isLoading } = useQuery({
    queryKey: ["allowed-images"],
    queryFn: api.allowedImages.list,
  });

  const createMut = useMutation({
    mutationFn: () => api.allowedImages.create({ alias, source, description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowed-images"] });
      toast.success("已添加");
      setAlias("");
      setSource("");
      setDescription("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.allowedImages.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["allowed-images"] });
      toast.success("已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function applyPreset(p: typeof PRESETS[number]) {
    setAlias(p.alias);
    setSource(p.source);
    setDescription(p.label);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">镜像白名单</h1>
      <p className="text-sm text-muted-foreground">
        用户创建实例时只能从这个列表中选择镜像。来源默认从 images.linuxcontainers.org 拉取，格式如 <code className="font-mono">ubuntu/24.04</code>。
      </p>

      <div className="border border-border rounded-lg p-4 bg-muted/10 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="别名（用户看到）">
            <input value={alias} onChange={(e) => setAlias(e.target.value)} className={inputCls} placeholder="ubuntu-2404" />
          </Field>
          <Field label="Source（Incus alias）">
            <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls} placeholder="ubuntu/24.04" />
          </Field>
          <Field label="说明">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="Ubuntu 24.04 LTS" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center mr-1">快捷：</span>
          {PRESETS.map((p) => (
            <button
              key={p.alias}
              onClick={() => applyPreset(p)}
              className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => createMut.mutate()}
          disabled={!alias.trim() || !source.trim() || createMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> 添加
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">别名</th>
              <th className="text-left px-4 py-2 font-medium">Source</th>
              <th className="text-left px-4 py-2 font-medium">说明</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">加载中...</td>
              </tr>
            )}
            {!isLoading && images.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">暂无镜像</td>
              </tr>
            )}
            {images.map((img) => (
              <tr key={img.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono">{img.alias}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{img.source}</td>
                <td className="px-4 py-3 text-muted-foreground">{img.description}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => {
                      if (confirm(`删除镜像 ${img.alias}？`)) deleteMut.mutate(img.id);
                    }}
                    className="text-muted-foreground hover:text-destructive p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
