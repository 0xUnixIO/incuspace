import { useEffect, useState } from "react";
import { api, User } from "../lib/api";
import { getCurrentUser } from "../lib/auth";
import { Trash2, Plus, KeyRound, Shield } from "lucide-react";

export default function UsersPage() {
  const me = getCurrentUser();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const [cu, setCu] = useState("");
  const [cp, setCp] = useState("");
  const [crole, setCrole] = useState<"admin" | "user">("user");
  const [creating, setCreating] = useState(false);

  const [pwUserId, setPwUserId] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      setUsers(await api.users.list());
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.users.create({ username: cu, password: cp, role: crole });
      setShowCreate(false);
      setCu(""); setCp(""); setCrole("user");
      await reload();
    } catch (e: any) {
      alert(e.message || "创建失败");
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(u: User) {
    if (!confirm(`删除用户 ${u.username}？此操作不可撤销。`)) return;
    try { await api.users.delete(u.id); await reload(); } catch (e: any) { alert(e.message); }
  }

  async function submitPw() {
    if (!pwUserId || pwValue.length < 6) { alert("密码至少 6 位"); return; }
    try { await api.users.updatePassword(pwUserId, pwValue); setPwUserId(null); setPwValue(""); alert("密码已更新"); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">用户管理</h1>
          <p className="text-sm text-muted-foreground">面板用户与角色（端口范围在每个实例上分配）</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-3 py-2 rounded-md text-sm hover:bg-primary/90">
          <Plus className="w-4 h-4" /> 新建用户
        </button>
      </div>

      {error && <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">{error}</div>}

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-accent/30 text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">用户名</th>
              <th className="text-left px-4 py-2 font-medium">角色</th>
              <th className="text-left px-4 py-2 font-medium">创建时间</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>}
            {!loading && users.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">暂无用户</td></tr>}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2">
                  {u.role === "admin"
                    ? <span className="inline-flex items-center gap-1 text-blue-400"><Shield className="w-3 h-3" />管理员</span>
                    : <span className="text-muted-foreground">普通用户</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(u.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-right space-x-2">
                  <button onClick={() => { setPwUserId(u.id); setPwValue(""); }}
                    title="重置密码" className="p-1 text-muted-foreground hover:text-primary">
                    <KeyRound className="w-4 h-4" />
                  </button>
                  {me?.id !== u.id && (
                    <button onClick={() => onDelete(u)} title="删除"
                      className="p-1 text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <form onSubmit={onCreate} className="bg-card border border-border rounded-lg p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-semibold">新建用户</h2>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">用户名</label>
              <input value={cu} onChange={(e) => setCu(e.target.value)} required
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">密码（≥ 6 位）</label>
              <input type="password" value={cp} onChange={(e) => setCp(e.target.value)} required minLength={6}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">角色</label>
              <select value={crole} onChange={(e) => setCrole(e.target.value as any)}
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm outline-none">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-3 py-2 rounded text-sm text-muted-foreground hover:text-foreground">取消</button>
              <button type="submit" disabled={creating}
                className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50">
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </form>
        </div>
      )}

      {pwUserId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-lg p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-semibold">重置密码</h2>
            <input type="password" value={pwValue} onChange={(e) => setPwValue(e.target.value)}
              placeholder="新密码（≥ 6 位）"
              className="w-full bg-input border border-border rounded px-3 py-2 text-sm outline-none" />
            <div className="flex justify-end gap-2">
              <button onClick={() => setPwUserId(null)} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">取消</button>
              <button onClick={submitPw} className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm">确认</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
