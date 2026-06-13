import type { BoardSnapshot, OrchestratorStatus } from "./types";

export const daemonBase = (window as typeof window & { KCA_DAEMON_URL?: string }).KCA_DAEMON_URL || import.meta.env.VITE_KCA_DAEMON_URL || "http://127.0.0.1:15000";

export function daemonWebSocketUrl() {
  const url = new URL(daemonBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/rpc";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function loadState() {
  return json<BoardSnapshot>(`${daemonBase}/api/state`);
}

export function queryOrchestrator() {
  return json<OrchestratorStatus>(`${daemonBase}/api/query`, {
    method: "POST",
    body: JSON.stringify({ type: "orchestrator.status" })
  });
}

export function queryDaemon<T>(query: Record<string, unknown>) {
  return json<T>(`${daemonBase}/api/query`, {
    method: "POST",
    body: JSON.stringify(query)
  });
}

export function commandDaemon<T>(command: Record<string, unknown>) {
  return json<T>(`${daemonBase}/api/command`, {
    method: "POST",
    body: JSON.stringify(command)
  });
}

export function commandId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
