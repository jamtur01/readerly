export const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:4000";

/**
 * Offline queue for write operations. Minimal implementation:
 * - Enqueue POST/PATCH/DELETE when network fails.
 * - Flush on window online and on app start.
 */
type OfflineJob = {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  token?: string;
  ts: number;
};

const QUEUE_KEY = "readerly.offlineQueue.v1";

function readQueue(): OfflineJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as OfflineJob[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: OfflineJob[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // ignore
  }
}

function enqueue(job: OfflineJob) {
  const q = readQueue();
  q.push(job);
  writeQueue(q);
}

export async function flushOfflineQueue(): Promise<void> {
  const q = readQueue();
  if (q.length === 0) return;
  const remaining: OfflineJob[] = [];
  for (const job of q) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (job.token) headers.Authorization = `Bearer ${job.token}`;
      const res = await fetch(`${API_ORIGIN}${job.path}`, {
        method: job.method,
        headers,
        body: job.body ? JSON.stringify(job.body) : undefined,
      });
      if (!res.ok)
        throw new Error(`${job.method} ${job.path} => ${res.status}`);
    } catch {
      remaining.push(job);
    }
  }
  writeQueue(remaining);
}

// Attach online listener in browser to flush queue
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushOfflineQueue();
  });
}

export async function apiGet<T>(
  path: string,
  opts: { token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API_ORIGIN}${path}`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts: { token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  } catch {
    // Network error: queue for later and resolve optimistically
    enqueue({ method: "POST", path, body, token: opts.token, ts: Date.now() });
    return {} as T;
  }
}

export async function apiPatch<T>(
  path: string,
  body: unknown,
  opts: { token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
  } catch {
    enqueue({ method: "PATCH", path, body, token: opts.token, ts: Date.now() });
    return {} as T;
  }
}

export async function apiDelete(
  path: string,
  opts: { token?: string } = {}
): Promise<void> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  } catch {
    enqueue({ method: "DELETE", path, ts: Date.now(), token: opts.token });
  }
}
