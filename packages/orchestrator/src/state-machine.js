import { logStep } from "@kca/core/log";

export function transitionTask(task, transition, payload = {}) {
  const now = payload.ts || new Date().toISOString();
  logStep("orchestrator", "state.transition", { taskId: task.id, transition });
  if (transition === "queue") return { ...task, status: "queued", updatedAt: now };
  if (transition === "start") return {
    ...task,
    status: "running",
    routing: { ...task.routing, currentAgent: payload.agentId || task.routing?.currentAgent || null },
    agent: { ...(typeof task.agent === "object" ? task.agent : {}), currentRunId: payload.runId, currentSessionRef: payload.sessionRef },
    updatedAt: now
  };
  if (transition === "complete") return {
    ...task,
    status: payload.nextColumn === "done" ? "done" : payload.status || "validating",
    column: payload.nextColumn === "done" ? "done" : task.column,
    routing: payload.nextColumn === "done"
      ? { ...task.routing, lastAgent: task.routing?.currentAgent || null, lastRole: task.routing?.currentRole || null, currentAgent: null, currentRole: null }
      : task.routing,
    workflow: payload.nextColumn === "done"
      ? { ...(task.workflow || {}), phase: "done", currentRole: "none", boardColumn: "done" }
      : task.workflow,
    updatedAt: now
  };
  if (transition === "wait_for_persona") return {
    ...task,
    status: "waiting",
    updatedAt: now
  };
  if (transition === "wait_for_human") return {
    ...task,
    status: "waiting_human",
    dependencies: { ...task.dependencies, blockedBy: [] },
    updatedAt: now
  };
  if (transition === "block") return {
    ...task,
    status: "blocked",
    dependencies: { ...task.dependencies, blockedBy: [] },
    updatedAt: now
  };
  if (transition === "manual_move") return {
    ...task,
    routing: {
      ...task.routing,
      manualOverride: {
        active: true,
        lastManualMoveAt: now,
        invalidatesRunId: task.agent?.currentRunId || null
      }
    },
    updatedAt: now
  };
  if (transition === "merge_pending") return { ...task, status: "merge_pending", updatedAt: now };
  if (transition === "merge_completed") return { ...task, status: "done", column: payload.nextColumn || "done", updatedAt: now };
  if (transition === "merge_conflict") return transitionTask(task, "block", { ...payload, blockers: payload.blockers || ["merge.conflict"] });
  const result = { ...task, updatedAt: now };
  logStep("orchestrator", "state.transition.done", { taskId: task.id, transition });
  return result;
}
