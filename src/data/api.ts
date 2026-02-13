// Tauri IPC bridge -- all API calls go through the Rust backend via invoke.
// Falls back to HTTP fetch when running outside Tauri (e.g. plain vite dev).

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function getInvoke(): InvokeFn | null {
  const w = window as unknown as Record<string, unknown>;
  const t = w.__TAURI__ as Record<string, unknown> | undefined;
  if (!t) return null;
  if (typeof t.invoke === "function") return t.invoke as InvokeFn;
  const inner = t.tauri as Record<string, unknown> | undefined;
  if (inner && typeof inner.invoke === "function") return inner.invoke as InvokeFn;
  return null;
}

const HTTP_BASE = "http://127.0.0.1:7777";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const invoke = getInvoke();
  if (invoke) {
    return invoke("api_call", { method, path, body: body ?? null }) as Promise<T>;
  }
  // Fallback: direct HTTP (for dev without tauri)
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${HTTP_BASE}${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> { return call<T>("GET", path); }
export function apiPost<T>(path: string, body: unknown): Promise<T> { return call<T>("POST", path, body); }
export function apiPut<T>(path: string, body: unknown): Promise<T> { return call<T>("PUT", path, body); }
export function apiDelete<T>(path: string): Promise<T> { return call<T>("DELETE", path); }
