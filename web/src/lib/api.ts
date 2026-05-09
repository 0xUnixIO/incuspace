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
      request<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
  },
  instances: {
    list: () => request<Instance[]>("/instances"),
    get: (name: string) => request<Instance>(`/instances/${name}`),
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
  },
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
  name: string;
  type: InstanceType;
  source: { type: string; alias?: string; server?: string; protocol?: string };
  profiles?: string[];
  config?: Record<string, string>;
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
