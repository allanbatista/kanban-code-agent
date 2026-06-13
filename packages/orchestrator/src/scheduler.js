import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl, boardSnapshot, getTask, listTasks, paths, readSettings, updateTask } from "@kca/fsdb";
import { acquireSemaphoreLeases, releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { logStep } from "@kca/core/log";

function taskSemaphores(task) {
  return (task.dependencies?.semaphores || []).map((item) => typeof item === "string" ? { name: item, tokens: 1 } : item).filter((item) => item?.name);
}

function taskAgent(task) {
  return task.routing?.currentAgent || task.routing?.currentRole || task.agent?.currentAgent || task.agent || "assistant";
}

export function semaphoreRequestsForTask(task, settings = {}) {
  const agentId = taskAgent(task);
  const runtime = settings.runtime || {};
  return [
    { name: "global:tasks", tokens: 1, capacity: runtime.maxParallelTasks ?? 1 },
    { name: `agent:${agentId}`, tokens: 1, capacity: runtime.agentTokens?.[agentId] ?? 1 },
    ...(task.projectTargets || []).map((projectId) => ({ name: `project:${projectId}:tasks`, tokens: 1, capacity: runtime.projectTokens?.[projectId] ?? 1 })),
    ...taskSemaphores(task)
  ].filter((request, index, list) => list.findIndex((item) => item.name === request.name) === index && (runtime.agentTokens?.[agentId] !== 0));
}

export async function schedulerTick(root, { whyNotRunning, runTask, maxStarts } = {}) {
  if (typeof whyNotRunning !== "function") throw new Error("schedulerTick requires whyNotRunning");
  if (typeof runTask !== "function") throw new Error("schedulerTick requires runTask");
  logStep("scheduler", "tick.start", { maxStarts: maxStarts ?? null });
  const snapshot = await boardSnapshot(root);
  const settings = await readSettings(root);
  const tasks = (await listTasks(root)).filter((task) => task.status === "queued");
  const limit = maxStarts ?? Math.max(0, (settings.runtime?.maxParallelTasks ?? 1) - snapshot.tasks.filter((task) => task.status === "running").length);
  const started = [];
  const skipped = [];
  const blocked = [];
  for (const task of tasks) {
    if (started.length >= limit) {
      skipped.push({ taskId: task.id, reason: "max_starts_reached" });
      continue;
    }
    const why = await whyNotRunning(task, root);
    if (!why.runnable) {
      skipped.push({ taskId: task.id, reasons: why.reasons });
      continue;
    }
    const agentId = taskAgent(task);
    const leases = await acquireSemaphoreLeases(semaphoreRequestsForTask(task, settings), {
      root,
      taskId: task.id,
      runId: `scheduler-${task.id}`,
      role: agentId
    });
    if (!leases.ok) {
      blocked.push({ taskId: task.id, semaphores: leases.blocked });
      continue;
    }
    try {
      const result = await runTask(task, { agentId, leases: leases.leases });
      const latest = await getTask(task.id, root);
      started.push({ taskId: task.id, agentId, leases: leases.leases, result, task: latest });
    } catch (error) {
      await releaseSemaphoreLeases({ root, leaseIds: leases.leases.map((lease) => lease.leaseId) });
      blocked.push({ taskId: task.id, error: error.message });
    }
  }
  const event = {
    ts: new Date().toISOString(),
    type: "scheduler.tick",
    actor: "orchestrator",
    started: started.map((item) => item.taskId),
    skipped,
    blocked
  };
  await appendJsonl(`${paths(root).runtime}/logs/events.jsonl`, event);
  logStep("scheduler", "tick.done", { started: started.map((item) => item.taskId), blocked: blocked.length, skipped: skipped.length });
  return { ok: true, event, started, skipped, blocked };
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
