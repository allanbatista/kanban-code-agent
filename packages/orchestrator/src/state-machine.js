export function transitionTask(task, transition, payload = {}) {
  const now = payload.ts || new Date().toISOString();
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
    column: payload.nextColumn || task.column,
    updatedAt: now
  };
  if (transition === "block") return {
    ...task,
    status: "blocked",
    column: "blocked",
    dependencies: { ...task.dependencies, blockedBy: [...(task.dependencies?.blockedBy || []), ...(payload.blockers || [])] },
    updatedAt: now
  };
  if (transition === "manual_move") return {
    ...task,
    column: payload.toColumn || task.column,
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
  return { ...task, updatedAt: now };
}
