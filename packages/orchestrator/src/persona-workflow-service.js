import { appendJsonl, normalizeColumnId, paths, updateTask, writeTaskFile } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { roleById } from "@kca/core/roles";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";

function roleColumn(roleId) {
  if (roleId === "done") return "done";
  return roleById(roleId)?.columnIds?.[0] || normalizeColumnId(roleId);
}

function roleAgent(roleId) {
  return roleById(roleId)?.agentId || roleId;
}

export async function waitForPersonaWorkflow(command, current, root) {
  const targetColumn = roleColumn(command.targetRole);
  const agentId = roleAgent(command.targetRole);
  const fromRole = current.routing?.currentRole || current.routing?.currentAgent || "assistant";
  const message = await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: fromRole, agentId: current.routing?.currentAgent || fromRole, runId: command.runId, disposition: "wait_for_persona", text: command.question, visibility: "both" });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "queued",
    column: targetColumn,
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: fromRole, currentAgent: agentId, currentRole: command.targetRole }
  }, root, "agent.waiting_for_persona"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "role.handoff", actor: fromRole, taskId: command.taskId, fromRole, toRole: command.targetRole, messageId: message.id });
  return { ok: true, commandId: command.commandId, task, message };
}

export async function waitForHumanWorkflow(command, current, root) {
  logStep("agent", "wait.human", { taskId: command.taskId, runId: command.runId, question: command.question });
  const relativePath = `summaries/input-${Date.now()}.md`;
  await writeTaskFile(command.taskId, relativePath, `# Input solicitado\n\n${command.question}\n\n${(command.options || []).map((option) => `- ${option}`).join("\n")}\n`, root);
  const requester = command.requestedByRole || current.routing?.currentRole || current.routing?.currentAgent || "assistant";
  const message = await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: requester, agentId: current.routing?.currentAgent || requester, runId: command.runId, disposition: "wait_for_human", text: command.question, visibility: "both" });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "idle",
    column: "human_wait",
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: requester, currentAgent: null, currentRole: null },
    dependencies: { ...current.dependencies, blockedBy: [] }
  }, root, "agent.waiting_for_human"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "human.input_requested", actor: requester, taskId: command.taskId, inputPath: relativePath, messageId: message.id });
  return { ok: true, commandId: command.commandId, task, inputPath: relativePath, message };
}

export async function delegateTaskWorkflow(command, current, root) {
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "delegation.requested", actor: command.fromPersona, taskId: command.taskId, fromPersona: command.fromPersona, toPersona: command.toPersona, wait: command.wait, request: command.request, expectedOutput: command.expectedOutput });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "queued",
    column: roleColumn(command.toPersona),
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: command.fromPersona, currentAgent: roleAgent(command.toPersona), currentRole: command.toPersona }
  }, root, "agent.waiting_for_persona"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task, delegation: { fromPersona: command.fromPersona, toPersona: command.toPersona, wait: command.wait } };
}
