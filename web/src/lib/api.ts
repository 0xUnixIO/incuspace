const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || res.statusText);
  }
  return res.json();
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    me: () => request<User>("/auth/me"),
  },
  users: {
    list: () => request<User[]>("/users"),
    create: (body: {
      username: string;
      password: string;
      role?: "admin" | "user";
    }) => request<User>("/users", { method: "POST", body: JSON.stringify(body) }),
    delete: (id: string) => request<void>(`/users/${id}`, { method: "DELETE" }),
    updatePassword: (id: string, password: string) =>
      request<void>(`/users/${id}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      }),
  },
  sshKeys: {
    list: () => request<SSHKey[]>("/ssh-keys"),
    add: (name: string, public_key: string) =>
      request<SSHKey>("/ssh-keys", { method: "POST", body: JSON.stringify({ name, public_key }) }),
    delete: (id: string) => request<void>(`/ssh-keys/${id}`, { method: "DELETE" }),
  },
  plans: {
    list: () => request<Plan[]>("/plans"),
    create: (body: Omit<Plan, "id" | "sold" | "created_at"> & { stock?: number | null }) =>
      request<Plan>("/plans", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, patch: Partial<Omit<Plan, "id" | "sold" | "created_at">>) =>
      request<Plan>(`/plans/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    delete: (id: string) => request<void>(`/plans/${id}`, { method: "DELETE" }),
  },
  allowedImages: {
    list: () => request<AllowedImage[]>("/allowed-images"),
    create: (body: { alias: string; source: string; description?: string }) =>
      request<AllowedImage>("/allowed-images", { method: "POST", body: JSON.stringify(body) }),
    delete: (id: string) => request<void>(`/allowed-images/${id}`, { method: "DELETE" }),
  },
  instances: {
    list: () => request<Instance[]>("/instances"),
    get: (name: string) => request<Instance>(`/instances/${name}`),
    panelInfo: (name: string) =>
      request<PanelInstance>(`/instances/${name}/panel-info`),
    create: (body: CreateInstanceRequest) =>
      request<Operation>("/instances", { method: "POST", body: JSON.stringify(body) }),
    action: (name: string, action: InstanceAction) =>
      request<Operation>(`/instances/${name}/action`, {
        method: "PUT",
        body: JSON.stringify({ action }),
      }),
    delete: (name: string) =>
      request<Operation>(`/instances/${name}`, { method: "DELETE" }),
    state: (name: string) => request<InstanceState>(`/instances/${name}/state`),
    updateConfig: (name: string, config: Record<string, string>, description?: string) =>
      request<Operation>(`/instances/${name}/config`, {
        method: "PATCH",
        body: JSON.stringify({ config, description }),
      }),
    snapshots: {
      list: (name: string) => request<Snapshot[]>(`/instances/${name}/snapshots`),
      create: (name: string, snapName: string, stateful = false) =>
        request<Operation>(`/instances/${name}/snapshots`, {
          method: "POST",
          body: JSON.stringify({ name: snapName, stateful }),
        }),
      delete: (name: string, snap: string) =>
        request<Operation>(`/instances/${name}/snapshots/${snap}`, { method: "DELETE" }),
      restore: (name: string, snap: string) =>
        request<Operation>(`/instances/${name}/snapshots/${snap}/restore`, { method: "POST" }),
    },
    sshKeys: {
      get: (name: string) => request<string[]>(`/instances/${name}/ssh-keys`),
      set: (name: string, keyIds: string[]) =>
        request<{ status: string }>(`/instances/${name}/ssh-keys`, {
          method: "PUT",
          body: JSON.stringify({ key_ids: keyIds }),
        }),
    },
    bandwidth: {
      get: (name: string) => request<Bandwidth>(`/instances/${name}/bandwidth`),
      put: (name: string, body: Partial<Bandwidth>) =>
        request<Operation>(`/instances/${name}/bandwidth`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
    },
    quota: {
      get: (name: string) => request<Quota>(`/instances/${name}/quota`),
      set: (name: string, limit_bytes: number, period: QuotaPeriod, action: QuotaAction) =>
        request<void>(`/instances/${name}/quota`, {
          method: "PUT",
          body: JSON.stringify({ limit_bytes, period, action }),
        }),
      delete: (name: string) =>
        request<void>(`/instances/${name}/quota`, { method: "DELETE" }),
      reset: (name: string) =>
        request<void>(`/instances/${name}/quota/reset`, { method: "POST" }),
    },
    proxyRules: {
      list: (name: string) => request<ProxyRule[]>(`/instances/${name}/proxy-rules`),
      add: (name: string, hostPort: number, containerPort: number, protocol = "tcp") =>
        request<Operation>(`/instances/${name}/proxy-rules`, {
          method: "POST",
          body: JSON.stringify({ host_port: hostPort, container_port: containerPort, protocol }),
        }),
      delete: (name: string, devName: string) =>
        request<Operation>(`/instances/${name}/proxy-rules/${devName}`, { method: "DELETE" }),
    },
  },
  hostInfo: () => request<{ ip: string }>("/host-info"),
  images: {
    list: () => request<Image[]>("/images"),
    listRemote: (server = "https://images.linuxcontainers.org") =>
      request<Image[]>(`/images/remote?server=${encodeURIComponent(server)}`),
    delete: (fingerprint: string) =>
      request<void>(`/images/${fingerprint}`, { method: "DELETE" }),
    pull: (alias: string, server = "https://images.linuxcontainers.org") =>
      request<Operation>("/images/pull", {
        method: "POST",
        body: JSON.stringify({ alias, server, protocol: "simplestreams" }),
      }),
  },
  networks: {
    list: () => request<Network[]>("/networks"),
    create: (name: string, cidr: string) =>
      request<{ name: string }>("/networks", {
        method: "POST",
        body: JSON.stringify({
          name,
          type: "bridge",
          config: { "ipv4.address": cidr, "ipv4.nat": "true", "ipv6.address": "none" },
        }),
      }),
    delete: (name: string) =>
      request<void>(`/networks/${name}`, { method: "DELETE" }),
  },
  storage: {
    pools: () => request<StoragePool[]>("/storage-pools"),
  },
  operations: {
    list: () => request<IncusOperation[]>("/operations"),
  },
  files: {
    list: (name: string, path: string) =>
      request<FileEntry[]>(`/instances/${name}/files?path=${encodeURIComponent(path)}`),
    download: async (name: string, path: string) => {
      const token = localStorage.getItem("token");
      const res = await fetch(`${BASE}/instances/${name}/files/download?path=${encodeURIComponent(path)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() ?? "file";
      a.click();
      URL.revokeObjectURL(url);
    },
    upload: (name: string, destPath: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const token = localStorage.getItem("token");
      return fetch(`${BASE}/instances/${name}/files?path=${encodeURIComponent(destPath)}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      }).then((res) => {
        if (!res.ok) return res.json().then((e) => { throw new Error(e.message); });
      });
    },
    delete: (name: string, path: string) =>
      request<void>(`/instances/${name}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  },
};

// --- 类型定义 ---

export type InstanceStatus = "Running" | "Stopped" | "Frozen" | "Error";
export type InstanceType = "container" | "virtual-machine";
export type InstanceAction = "start" | "stop" | "restart" | "freeze" | "unfreeze";

export interface Instance {
  name: string;
  type: InstanceType;
  status: InstanceStatus;
  description: string;
  created_at: string;
  profiles: string[];
  config: Record<string, string>;
  expanded_config?: Record<string, string>;
  port_range_start?: number;
  port_range_end?: number;
}

export interface InstanceState {
  status: InstanceStatus;
  cpu: { usage: number };
  memory: { usage: number; usage_peak: number; total: number };
  disk: Record<string, { usage: number; total: number }>;
  network: Record<string, { addresses: NetworkAddress[]; counters: NetworkCounters }>;
}

export interface NetworkAddress {
  family: string;
  address: string;
  netmask: string;
  scope: string;
}

export interface NetworkCounters {
  bytes_received: number;
  bytes_sent: number;
  packets_received: number;
  packets_sent: number;
}

export interface CreateInstanceRequest {
  display_name: string;
  plan_id: string;
  image: string;
  ssh_key_ids?: string[];
}

export interface Plan {
  id: string;
  name: string;
  cpu: number;
  memory_mb: number;
  traffic_gb: number;
  bandwidth_mbps: number;
  ports: number;
  stock?: number | null;
  sold: number;
  enabled: boolean;
  auto_start: boolean;
  created_at: string;
}
export interface AllowedImage {
  id: string;
  alias: string;
  source: string;
  description: string;
  created_at: string;
}

export interface Bandwidth {
  nic_name: string;
  ingress: string;
  egress: string;
  priority: string;
}

export type QuotaPeriod = "monthly" | "total";
export type QuotaAction = "stop" | "freeze" | "notify";

export interface Quota {
  enabled: boolean;
  limit_bytes: number;
  period: QuotaPeriod;
  action: QuotaAction;
  used_bytes: number;
  triggered: boolean;
  last_poll_at?: string;
  last_reset_at?: string;
}

export interface ProxyRule {
  name: string;
  protocol: string;
  host_port: number;
  container_port: number;
}

export interface SSHKey {
  id: string;
  name: string;
  public_key: string;
  created_at: string;
}

export interface Operation {
  id: string;
  status: string;
  description: string;
}

export interface Image {
  fingerprint: string;
  aliases: { name: string; description: string }[];
  architecture: string;
  size: number;
  created_at: string;
  type: string;
  properties?: { os?: string; release?: string; description?: string; [k: string]: string | undefined };
}

export interface Network {
  name: string;
  type: string;
  status: string;
  managed: boolean;
  config: Record<string, string>;
}

export interface IncusOperation {
  id: string;
  type: string;
  description: string;
  status: string;
  status_code: number;
  created_at: string;
  updated_at: string;
  may_cancel: boolean;
  err: string;
  metadata: Record<string, any> | null;
  resources: Record<string, string[]> | null;
}

export interface StoragePool {
  name: string;
  driver: string;
  status: string;
  config: Record<string, string>;
}

export interface Snapshot {
  name: string;
  created_at: string;
  stateful: boolean;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  mode: number;
}

export interface User {
  id: string;
  username: string;
  role: "admin" | "user";
  created_at: string;
}

export interface PanelInstance {
  id: string;
  name: string;
  display_name: string;
  owner_id: string;
  spec_cpu: number;
  spec_memory_mb: number;
  port_range_start: number;
  port_range_end: number;
  plan_id?: string | null;
  image: string;
  plan?: Plan;
  created_at: string;
}
