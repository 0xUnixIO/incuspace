import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function NetworksPage() {
  const { data: networks = [], isLoading } = useQuery({
    queryKey: ["networks"],
    queryFn: api.networks.list,
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">加载中...</div>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">网络</h1>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/30">
            <tr>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">名称</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">类型</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">状态</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">托管</th>
              <th className="text-left px-4 py-3 text-muted-foreground font-medium">CIDR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {networks.map((net) => (
              <tr key={net.name} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3 font-mono">{net.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{net.type}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${net.status === "Created" ? "text-green-400" : "text-muted-foreground"}`}>
                    {net.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{net.managed ? "是" : "否"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {net.config["ipv4.address"] || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {networks.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">暂无网络配置</div>
        )}
      </div>
    </div>
  );
}
