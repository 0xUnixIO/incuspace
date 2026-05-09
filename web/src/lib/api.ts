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
  },
  images: {
    list: () => request<Image[]>("/images"),
    delete: (fingerprint: string) =>
      request<void>(`/images/${fingerprint}`, { method: "DELETE" }),
  },
  networks: {
    list: () => request<Network[]>("/networks"),
  },
  storage: {
    pools: () => request<StoragePool[]>("/storage-pools"),
  },
  operations: {
    list: () => request<IncusOperation[]>("/operations"),
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
