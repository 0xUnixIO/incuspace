import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { api, type Plan } from "../lib/api";
import { cn } from "../lib/utils";

const inputCls =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring";

interface FormState {
  name: string;
  cpu: string;
  memory_mb: string;
  traffic_gb: string;
  bandwidth_mbps: string;
  ports: string;
  stock: string; // 空=不限
  enabled: boolean;
  auto_start: boolean;
}

const empty: FormState = {
  name: "",
  cpu: "1",
  memory_mb: "512",
  traffic_gb: "100",
  bandwidth_mbps: "100",
  ports: "10",
  stock: "",
  enabled: true,
  auto_start: true,
};

function toPayload(f: FormState) {
  return {
    name: f.name.trim(),
    cpu: Number(f.cpu),
    memory_mb: Number(f.memory_mb),
    traffic_gb: Number(f.traffic_gb),
    bandwidth_mbps: Number(f.bandwidth_mbps),
    ports: Number(f.ports),
    stock: f.stock.trim() === "" ? null : Number(f.stock),
    enabled: f.enabled,
    auto_start: f.auto_start,
  };
}

export default function PlansPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(empty);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: api.plans.list,
  });

  const createMut = useMutation({
    mutationFn: () => api.plans.create(toPayload(form)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("已创建");
      setAdding(false);
      setForm(empty);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id }: { id: string }) => api.plans.update(id, toPayload(editForm)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("已保存");
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.plans.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("已删除");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit(p: Plan) {
    setEditing(p.id);
    setEditForm({
      name: p.name,
      cpu: String(p.cpu),
      memory_mb: String(p.memory_mb),
      traffic_gb: String(p.traffic_gb),
      bandwidth_mbps: String(p.bandwidth_mbps),
      ports: String(p.ports),
      stock: p.stock == null ? "" : String(p.stock),
      enabled: p.enabled,
      auto_start: p.auto_start,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">套餐管理</h1>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> 新增套餐
        </button>
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-4 bg-muted/10">
          <PlanForm form={form} setForm={setForm} />
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending || !form.name.trim()}
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              保存
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setForm(empty);
              }}
              className="px-3 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">名称</th>
              <th className="text-left px-4 py-2 font-medium">CPU/内存</th>
              <th className="text-left px-4 py-2 font-medium">流量/带宽</th>
              <th className="text-left px-4 py-2 font-medium">端口</th>
              <th className="text-left px-4 py-2 font-medium">已售/库存</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  加载中...
                </td>
              </tr>
            )}
            {!isLoading && plans.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  暂无套餐
                </td>
              </tr>
            )}
            {plans.map((p) =>
              editing === p.id ? (
                <tr key={p.id} className="border-t border-border">
                  <td colSpan={7} className="p-3 bg-muted/10">
                    <PlanForm form={editForm} setForm={setEditForm} />
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => updateMut.mutate({ id: p.id })}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        <Check className="w-3.5 h-3.5" /> 保存
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md border border-border text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" /> 取消
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.cpu} 核 · {p.memory_mb} MB</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.traffic_gb} GB · {p.bandwidth_mbps} Mbps</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.ports}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.sold} / {p.stock == null ? "∞" : p.stock}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] border",
                        p.enabled
                          ? "border-green-500/30 text-green-400 bg-green-500/10"
                          : "border-zinc-500/30 text-zinc-400 bg-zinc-500/10"
                      )}
                    >
                      {p.enabled ? "启用" : "停用"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => startEdit(p)}
                      className="text-muted-foreground hover:text-foreground p-1"
                      title="编辑"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`确认删除套餐 ${p.name}？`)) deleteMut.mutate(p.id);
                      }}
                      className="text-muted-foreground hover:text-destructive p-1 ml-1"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanForm({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  function update<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm({ ...form, [k]: v });
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Field label="名称">
        <input className={inputCls} value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="small" />
      </Field>
      <Field label="CPU 核数">
        <input className={inputCls} type="number" value={form.cpu} onChange={(e) => update("cpu", e.target.value)} />
      </Field>
      <Field label="内存 (MB)">
        <input className={inputCls} type="number" value={form.memory_mb} onChange={(e) => update("memory_mb", e.target.value)} />
      </Field>
      <Field label="月流量 (GB)">
        <input className={inputCls} type="number" value={form.traffic_gb} onChange={(e) => update("traffic_gb", e.target.value)} />
      </Field>
      <Field label="带宽 (Mbps)">
        <input className={inputCls} type="number" value={form.bandwidth_mbps} onChange={(e) => update("bandwidth_mbps", e.target.value)} />
      </Field>
      <Field label="端口数">
        <input className={inputCls} type="number" value={form.ports} onChange={(e) => update("ports", e.target.value)} />
      </Field>
      <Field label="库存（空=不限）">
        <input className={inputCls} type="number" value={form.stock} onChange={(e) => update("stock", e.target.value)} placeholder="例: 10" />
      </Field>
      <Field label="启用">
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={form.enabled} onChange={(e) => update("enabled", e.target.checked)} />
          {form.enabled ? "启用中" : "已停用"}
        </label>
      </Field>
      <Field label="创建后自动启动">
        <label className="flex items-center gap-2 mt-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={form.auto_start} onChange={(e) => update("auto_start", e.target.checked)} />
          {form.auto_start ? "自动启动" : "手动启动"}
        </label>
      </Field>
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
