import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { Server, Image, Network, Database, LogOut, Activity, KeyRound, Users, Package, Disc } from "lucide-react";
import { getCurrentUser, isAdmin, logout as doLogout } from "../lib/auth";

const baseNav = [
  { to: "/instances", icon: Server, label: "实例" },
  { to: "/images", icon: Image, label: "镜像" },
  { to: "/networks", icon: Network, label: "网络" },
  { to: "/storage", icon: Database, label: "存储" },
  { to: "/ssh-keys", icon: KeyRound, label: "SSH 公钥" },
];

const adminNav = [
  { to: "/users", icon: Users, label: "用户管理" },
  { to: "/plans", icon: Package, label: "套餐" },
  { to: "/allowed-images", icon: Disc, label: "镜像白名单" },
];

export default function Layout() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const nav = isAdmin() ? [...baseNav, ...adminNav] : baseNav;

  function logout() {
    doLogout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* 侧边栏 */}
      <aside className="w-56 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          <span className="font-semibold text-sm tracking-wide">Incus Panel</span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
            <div className="truncate">{user.username}</div>
            <div className="text-[10px] opacity-60">
              {user.role === "admin" ? "管理员" : "普通用户"}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="flex items-center gap-3 px-5 py-4 text-sm text-muted-foreground hover:text-destructive transition-colors border-t border-border"
        >
          <LogOut className="w-4 h-4" />
          退出登录
        </button>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
