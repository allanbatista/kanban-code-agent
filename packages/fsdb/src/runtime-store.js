import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { logStep } from "@kca/core/log";

function storageRoot(root = process.env.KCA_STORAGE_ROOT) {
  return resolve(root || join(homedir(), ".kanban-code-agent"));
}

function runtimePath(rootInput, file = "") {
  return join(storageRoot(rootInput), "settings", "runtime", file);
}

async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

export async function readSemaphoreState(rootInput) {
  logStep("fsdb", "readSemaphoreState", { root: storageRoot(rootInput) });
  try {
    return YAML.parse(await readFile(runtimePath(rootInput, "semaphores.yaml"), "utf8"));
  } catch {
    return { schema: "kanban-code-agent/semaphores@1", tokens: {}, leases: [] };
  }
}

export async function writeSemaphoreState(state, rootInput) {
  const next = { schema: "kanban-code-agent/semaphores@1", tokens: {}, leases: [], ...state };
  await writeAtomic(runtimePath(rootInput, "semaphores.yaml"), YAML.stringify(next));
  logStep("fsdb", "writeSemaphoreState", { root: storageRoot(rootInput) });
  return next;
}

function activeLeases(state, now = Date.now()) {
  return (state.leases || []).filter((lease) => !lease.expiresAt || Date.parse(lease.expiresAt) > now);
}

export async function acquireSemaphoreLeases(requests, { root, taskId, runId, role, ttlMs = 15 * 60 * 1000 } = {}) {
  logStep("fsdb", "acquireSemaphoreLeases.start", { taskId: taskId || null, runId: runId || null, requests: requests.length });
  const state = await readSemaphoreState(root);
  const leases = activeLeases(state);
  const normalized = requests.map((item) => typeof item === "string" ? { name: item, tokens: 1 } : { tokens: 1, ...item });
  const blocked = [];
  for (const request of normalized) {
    const capacity = request.capacity ?? state.tokens?.[request.name] ?? request.tokens ?? 1;
    const used = leases.filter((lease) => lease.name === request.name).length;
    if (used + (request.tokens || 1) > capacity) blocked.push({ name: request.name, used, capacity });
  }
  if (blocked.length) {
    logStep("fsdb", "acquireSemaphoreLeases.blocked", { taskId: taskId || null, runId: runId || null, blocked: blocked.map((item) => item.name) });
    return { ok: false, blocked, state: { ...state, leases } };
  }
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const leaseIdBase = `${taskId || "task"}-${runId || "run"}-${Date.now()}`;
  const newLeases = normalized.flatMap((request) => Array.from({ length: request.tokens || 1 }, (_, index) => ({
    name: request.name,
    leaseId: `${leaseIdBase}-${index}`,
    taskId,
    runId,
    role,
    acquiredAt,
    expiresAt
  })));
  const next = await writeSemaphoreState({ ...state, leases: [...leases, ...newLeases] }, root);
  const result = { ok: true, leases: newLeases, state: next };
  logStep("fsdb", "acquireSemaphoreLeases.done", { taskId: taskId || null, runId: runId || null, leases: newLeases.length });
  return result;
}

export async function releaseSemaphoreLeases({ root, leaseIds = [], runId, taskId } = {}) {
  logStep("fsdb", "releaseSemaphoreLeases.start", { taskId: taskId || null, runId: runId || null, leaseIds: leaseIds.length });
  const state = await readSemaphoreState(root);
  const ids = new Set(leaseIds);
  const leases = activeLeases(state).filter((lease) => {
    if (ids.size && ids.has(lease.leaseId)) return false;
    if (runId && lease.runId === runId) return false;
    if (taskId && lease.taskId === taskId) return false;
    return true;
  });
  const result = await writeSemaphoreState({ ...state, leases }, root);
  logStep("fsdb", "releaseSemaphoreLeases.done", { taskId: taskId || null, runId: runId || null });
  return result;
}
