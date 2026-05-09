import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Folder, File, Download, Trash2, Upload, ArrowLeft, ChevronRight } from "lucide-react";

export default function InstanceFilesPage() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [currentPath, setCurrentPath] = useState("/");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["files", name, currentPath],
    queryFn: () => api.files.list(name!, currentPath),
    enabled: !!name,
  });

  function navigateTo(path: string) {
    setCurrentPath(path);
    qc.invalidateQueries({ queryKey: ["files", name, path] });
  }

  // 面包屑：把当前路径分段
  const crumbs =
    currentPath === "/"
      ? [{ label: "/", path: "/" }]
      : ["/", ...currentPath.slice(1).split("/")].reduce<{ label: string; path: string }[]>(
          (acc, seg, i) => {
            const prev = acc[i - 1]?.path ?? "";
            acc.push({
              label: seg || "/",
              path: i === 0 ? "/" : prev.replace(/\/$/, "") + "/" + seg,
            });
            return acc;
          },
          []
        );

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !name) return;
    const destPath = currentPath.replace(/\/$/, "") + "/" + file.name;
    setUploading(true);
    try {
      await api.files.upload(name, destPath, file);
      toast.success(`${file.name} 上传成功`);
      qc.invalidateQueries({ queryKey: ["files", name, currentPath] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "上传失败";
      toast.error(msg);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDelete(entryName: string) {
    if (!name || !confirm(`确认删除 ${entryName}？`)) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entryName;
    try {
      await api.files.delete(name, filePath);
      toast.success("已删除");
      qc.invalidateQueries({ queryKey: ["files", name, currentPath] });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败";
      toast.error(msg);
    }
  }

  async function handleDownload(entryName: string) {
    if (!name) return;
    const filePath = currentPath.replace(/\/$/, "") + "/" + entryName;
    try {
      await api.files.download(name, filePath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "下载失败";
      toast.error(msg);
    }
  }

  // 排序：目录在前，文件在后，同类按名称排序
  const sorted = [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      {/* 顶部栏：返回 + 面包屑 + 上传按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/instances/${name}`)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="返回实例详情"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {/* 面包屑 */}
          <div className="flex items-center gap-1 text-sm font-mono">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <button
                  onClick={() => navigateTo(c.path)}
                  className={
                    c.path === currentPath
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground transition-colors"
                  }
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {uploading ? "上传中..." : "上传文件"}
          </button>
        </div>
      </div>

      {/* 文件列表 */}
      <div className="border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground text-sm">加载中...</div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">目录为空</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">名称</th>
                <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((entry) => (
                <tr key={entry.name} className="hover:bg-accent/30 transition-colors group">
                  <td className="px-4 py-2.5">
                    <button
                      className="flex items-center gap-2 text-left w-full"
                      onClick={() => {
                        if (entry.type === "directory") {
                          navigateTo(currentPath.replace(/\/$/, "") + "/" + entry.name);
                        } else {
                          handleDownload(entry.name);
                        }
                      }}
                    >
                      {entry.type === "directory" ? (
                        <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                      ) : (
                        <File className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className={entry.type === "directory" ? "text-blue-400 hover:underline" : ""}>
                        {entry.name}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">
                    {entry.type === "directory" ? "目录" : entry.type === "symlink" ? "链接" : "文件"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entry.type !== "directory" && (
                        <button
                          onClick={() => handleDownload(entry.name)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                          title="下载"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(entry.name)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
