import { appendJsonl, getTask, paths, updateTask, writeTaskFile } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { TaskSchema } from "@kca/schemas";
import { runDeployment } from "./deployment-service.js";
import { evaluateReview } from "./review-service.js";
import { normalizeWorkflow } from "./spec-workflow-service.js";

function assertActiveRun(current, runId) {
  if (!runId) return;
  if (current.agent?.currentRunId && current.agent.currentRunId !== runId) throw new Error("run_mismatch");
  if (current.routing?.manualOverride?.active && current.routing.manualOverride.invalidatesRunId === runId) throw new Error("manual_override_active");
}

const TERMINAL_STATUSES = new Set(["done", "canceled"]);

function parentIdForTask(task) {
  return task?.parentTaskId || task?.worktree?.parentTaskId || null;
}

async function requeueParentForSubtaskDecision(child, root, disposition, text) {
  const parentTaskId = parentIdForTask(child);
  if (!parentTaskId) return null;
  const parent = await getTask(parentTaskId, root);
  if (!parent) return null;
  await appendChatMessage(root, { scope: "task", taskId: parentTaskId, role: "assistant", persona: "orchestrator", agentId: "orchestrator", disposition, text, visibility: "both" });
  await appendJsonl(`${paths(root).tasks}/${parentTaskId}/events.jsonl`, { ts: new Date().toISOString(), type: disposition, actor: "orchestrator", taskId: parentTaskId, subtaskId: child.id });
  if (TERMINAL_STATUSES.has(parent.status) || parent.status === "queued") return parent;
  return TaskSchema.parse(await updateTask(parentTaskId, { status: "queued", column: parent.column, routing: parent.routing }, root, disposition));
}

export async function reviewTaskGate(command, current, root) {
  assertActiveRun(current, command.runId);
  const review = evaluateReview({ findings: command.findings, evidence: command.evidence });
  await writeTaskFile(command.taskId, `artifacts/review-${Date.now()}.json`, JSON.stringify(review, null, 2), root);
  if (review.mergeReady) {
    if (parentIdForTask(current)) {
      const text = `Subtask aguardando review: ${command.taskId}. Review aprovado com evidencia: ${(command.evidence || []).join("; ") || "sem evidencia informada"}.`;
      const task = TaskSchema.parse(await updateTask(command.taskId, {
        status: "waiting_review",
        column: current.column,
        routing: current.routing,
        workflow: normalizeWorkflow(current)
      }, root, "subtask.review_requested"));
      await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: current.routing?.currentRole || current.routing?.currentAgent || "review", agentId: current.routing?.currentAgent || "review", runId: command.runId, disposition: "subtask.review_requested", text, visibility: "both" });
      await appendReviewEvent(command, root, review, "passed");
      const parentTask = await requeueParentForSubtaskDecision(task, root, "subtask.review_requested", text);
      await releaseSemaphoreLeases({ root, taskId: command.taskId });
      return { ok: true, commandId: command.commandId, task, review, parentTask, reviewPending: true };
    }
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "queued",
      column: current.column,
      routing: current.routing,
      workflow: normalizeWorkflow(current)
    }, root, "gate.passed"));
    await appendReviewEvent(command, root, review, "passed");
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task, review };
  }
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "waiting",
    column: current.column,
    routing: current.routing,
    workflow: normalizeWorkflow(current)
  }, root, "gate.failed"));
  await appendReviewEvent(command, root, review, "failed");
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: false, commandId: command.commandId, task, review };
}

export async function deployTaskGate(command, current, root) {
  assertActiveRun(current, command.runId);
  const deployment = await runDeployment({ taskId: command.taskId, command: command.command, args: command.args, cwd: command.cwd || paths(root).root, rollback: command.rollback });
  await writeTaskFile(command.taskId, `artifacts/deployment-${Date.now()}.json`, JSON.stringify(deployment, null, 2), root);
  const workflow = normalizeWorkflow(current);
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "waiting",
    column: current.column,
    routing: current.routing,
    workflow
  }, root, "gate.passed"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "deployment.recorded", actor: "deployment", taskId: command.taskId, runId: command.runId, gate: "deployment", deployment });
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task, deployment };
}

async function appendReviewEvent(command, root, review, status) {
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: status === "passed" ? "gate.passed" : "gate.failed", actor: "review", taskId: command.taskId, runId: command.runId, gate: "review", review });
}
