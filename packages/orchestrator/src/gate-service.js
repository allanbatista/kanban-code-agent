import { boardSnapshot, normalizeColumnId, paths, updateTask, writeTaskFile } from "@kca/fsdb";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { roleById } from "@kca/core/roles";
import { TaskSchema } from "@kca/schemas";
import { runDeployment } from "./deployment-service.js";
import { evaluateReview } from "./review-service.js";

function roleAgent(roleId) {
  return roleById(roleId)?.agentId || roleId;
}

function assertActiveRun(current, runId) {
  if (!runId) return;
  if (current.agent?.currentRunId && current.agent.currentRunId !== runId) throw new Error("run_mismatch");
  if (current.routing?.manualOverride?.active && current.routing.manualOverride.invalidatesRunId === runId) throw new Error("manual_override_active");
}

export async function reviewTaskGate(command, current, root) {
  assertActiveRun(current, command.runId);
  const review = evaluateReview({ findings: command.findings, evidence: command.evidence });
  await writeTaskFile(command.taskId, `artifacts/review-${Date.now()}.json`, JSON.stringify(review, null, 2), root);
  if (review.mergeReady) {
    const column = normalizeColumnId(command.passColumn);
    const target = (await boardSnapshot(root)).columns.find((item) => item.id === column);
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: column === "done" ? "done" : "queued",
      column,
      routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: target?.agent || roleAgent(column), currentRole: target?.role || column }
    }, root, "gate.passed"));
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task, review };
  }
  const failRole = command.failRole;
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "queued",
    column: roleById(failRole)?.columnIds?.[0] || normalizeColumnId(failRole),
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: roleAgent(failRole), currentRole: failRole }
  }, root, "gate.failed"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: false, commandId: command.commandId, task, review };
}

export async function deployTaskGate(command, current, root) {
  assertActiveRun(current, command.runId);
  const deployment = await runDeployment({ taskId: command.taskId, command: command.command, args: command.args, cwd: command.cwd || paths(root).root, rollback: command.rollback });
  await writeTaskFile(command.taskId, `artifacts/deployment-${Date.now()}.json`, JSON.stringify(deployment, null, 2), root);
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "done",
    column: "done",
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: null, currentRole: null }
  }, root, "gate.passed"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task, deployment };
}
