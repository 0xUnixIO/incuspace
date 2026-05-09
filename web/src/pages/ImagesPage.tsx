import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Image } from "../lib/api";
import { Trash2 } from "lucide-react";
import { formatBytes } from "../lib/utils";

export default function ImagesPage() {
  const qc = useQueryClient();
  const { data: images = [], isLoading } = useQuery({
    queryKey: ["images"],
    queryFn: api.images.list,
  });

  const deleteMutation = useMutation({
    mutationFn: (fp: string) => api.images.delete(fp),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["images"] }),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">镜像</h1>
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
                      if (confirm(`确认删除此镜像？`)) deleteMutation.mutate(img.fingerprint);
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
    </div>
  );
}
