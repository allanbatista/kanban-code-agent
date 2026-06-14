import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl, boardSnapshot, getTask, listTasks, paths, readAgent, readSettings, updateTask } from "@kca/fsdb";
import { acquireSemaphoreLeases, releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { logStep } from "@kca/core/log";
import { agentMaxParallelTasks, agentSchedulingEnabled } from "./agent-capacity.js";

function taskSemaphores(task) {
  return (task.dependencies?.semaphores || []).map((item) => typeof item === "string" ? { name: item, tokens: 1 } : item).filter((item) => item?.name);
}

function taskAgent(task) {
  return task.routing?.currentAgent || task.routing?.currentRole || task.agent?.currentAgent || task.agent || "assistant";
}

function eligibleAutoStartTask(task, autoStartColumnIds) {
  return task.status === "idle"
    && autoStartColumnIds.has(task.column)
    && !task.routing?.manualOverride?.active
    && !(task.dependencies?.blockedBy || []).length;
}

async function normalizeAutoStartTasks(root, snapshot) {
  const autoStartColumns = new Map(snapshot.columns.filter((column) => column.autoStart).map((column) => [column.id, column]));
  const autoStartColumnIds = new Set(autoStartColumns.keys());
  const autoQueued = [];
  for (const task of await listTasks(root)) {
    const column = autoStartColumns.get(task.column);
    if (!column || !eligibleAutoStartTask(task, autoStartColumnIds)) continue;
    const updated = await updateTask(task.id, {
      status: "queued",
      routing: {
        ...task.routing,
        currentAgent: column.agent || task.routing?.currentAgent,
        currentRole: column.role || column.agent || task.routing?.currentRole
      }
    }, root, "agent.queued");
    autoQueued.push(updated.id);
  }
  return autoQueued;
}

export function semaphoreRequestsForTask(task, settings = {}) {
  const agentId = taskAgent(task);
  const runtime = settings.runtime || {};
  const agentSettings = settings.agentSettings;
  return [
    { name: "global:tasks", tokens: 1, capacity: runtime.maxParallelTasks ?? 1 },
    { name: `agent:${agentId}`, tokens: 1, capacity: agentMaxParallelTasks(agentSettings, runtime, agentId) },
    ...(task.projectTargets || []).map((projectId) => ({ name: `project:${projectId}:tasks`, tokens: 1, capacity: runtime.projectTokens?.[projectId] ?? 1 })),
    ...taskSemaphores(task)
  ].filter((request, index, list) => list.findIndex((item) => item.name === request.name) === index && agentSchedulingEnabled(agentSettings, runtime, agentId));
}

export async function schedulerTick(root, { whyNotRunning, runTask, maxStarts } = {}) {
  if (typeof whyNotRunning !== "function") throw new Error("schedulerTick requires whyNotRunning");
  if (typeof runTask !== "function") throw new Error("schedulerTick requires runTask");
  logStep("scheduler", "tick.start", { maxStarts: maxStarts ?? null });
  const snapshot = await boardSnapshot(root);
  const settings = await readSettings(root);
  const autoQueued = await normalizeAutoStartTasks(root, snapshot);
  const tasks = (await listTasks(root)).filter((task) => task.status === "queued");
  const limit = maxStarts ?? Math.max(0, (settings.runtime?.maxParallelTasks ?? 1) - snapshot.tasks.filter((task) => task.status === "running").length);
  const started = [];
  const launched = [];
  const skipped = [];
  const blocked = [];
  for (const task of tasks) {
    if (launched.length >= limit) {
      skipped.push({ taskId: task.id, reason: "max_starts_reached" });
      continue;
    }
    const why = await whyNotRunning(task, root);
    if (!why.runnable) {
      skipped.push({ taskId: task.id, reasons: why.reasons });
      continue;
    }
    const agentId = taskAgent(task);
    const agentSettings = await readAgent(agentId, root);
    const leases = await acquireSemaphoreLeases(semaphoreRequestsForTask(task, { ...settings, agentSettings }), {
      root,
      taskId: task.id,
      runId: `scheduler-${task.id}`,
      role: agentId
    });
    if (!leases.ok) {
      blocked.push({ taskId: task.id, semaphores: leases.blocked });
      continue;
    }
    launched.push(Promise.resolve()
      .then(() => runTask(task, { agentId, leases: leases.leases }))
      .then(async (result) => ({ ok: true, taskId: task.id, agentId, leases: leases.leases, result, task: await getTask(task.id, root) }))
      .catch(async (error) => {
        await releaseSemaphoreLeases({ root, leaseIds: leases.leases.map((lease) => lease.leaseId) });
        return { ok: false, taskId: task.id, error: error.message };
      }));
  }
  for (const outcome of await Promise.all(launched)) {
    if (outcome.ok) started.push(outcome);
    else blocked.push({ taskId: outcome.taskId, error: outcome.error });
  }
  const event = {
    ts: new Date().toISOString(),
    type: "scheduler.tick",
    actor: "orchestrator",
    autoQueued,
    started: started.map((item) => item.taskId),
    skipped,
    blocked
  };
  await appendJsonl(`${paths(root).runtime}/logs/events.jsonl`, event);
  logStep("scheduler", "tick.done", { autoQueued, started: started.map((item) => item.taskId), blocked: blocked.length, skipped: skipped.length });
  return { ok: true, event, autoQueued, started, skipped, blocked };
}

async function sessionHasPromptNotSent(root, task) {
  const sessionRef = task.agent?.currentSessionRef;
  if (!sessionRef) return false;
  try {
    const content = await readFile(join(paths(root).root, sessionRef), "utf8");
    return content.split("\n").filter(Boolean).some((line) => {
      try {
        const event = JSON.parse(line);
        return event.type === "agent.adapter" && event.adapter?.promptSent === false;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function recoverStaleRuns(root) {
  logStep("scheduler", "recoverStaleRuns.start");
  const recovered = [];
  for (const task of (await listTasks(root)).filter((item) => item.status === "running")) {
    if (!(await sessionHasPromptNotSent(root, task))) continue;
    const reason = "prompt_not_sent";
    const updated = await updateTask(task.id, { status: "failed" }, root, "agent.failed");
    await appendJsonl(`${paths(root).tasks}/${task.id}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.failed", actor: "scheduler", taskId: task.id, runId: task.agent?.currentRunId, reason });
    await releaseSemaphoreLeases({ root, taskId: task.id });
    recovered.push({ taskId: task.id, reason, task: updated });
  }
  logStep("scheduler", "recoverStaleRuns.done", { recovered: recovered.length });
  return { ok: true, recovered };
}
