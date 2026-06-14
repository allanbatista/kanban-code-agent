import { appendJsonl, createTask, normalizeColumnId, paths, readYaml, updateTask, writeTaskFile, writeYaml } from "@kca/fsdb";
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
  const targetRole = command.toPersona;
  const targetColumn = roleColumn(targetRole);
  const agentId = roleAgent(targetRole);
  const mainTaskId = current.worktree?.mainTaskId || current.worktree?.parentTaskId || current.id;
  const childId = `${current.id}-${Date.now().toString(36)}`;
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "delegation.requested", actor: command.fromPersona, taskId: command.taskId, fromPersona: command.fromPersona, toPersona: command.toPersona, wait: command.wait, request: command.request, expectedOutput: command.expectedOutput });
  const child = TaskSchema.parse(await createTask({
    id: childId,
    title: `${current.title}: ${targetRole}`,
    kind: "subtask",
    column: targetColumn,
    status: "queued",
    projectTargets: current.projectTargets,
    agent: agentId,
    role: targetRole,
    description: [
      `Delegated request: ${command.request}`,
      `Expected output: ${command.expectedOutput || "Report result to parent task."}`,
      `Parent task id: ${current.id}`,
      `Main task id: ${mainTaskId}`,
      `Target persona: ${targetRole}`
    ].join("\n\n"),
    worktree: { enabled: true, kind: "subtask", branch: `kca/${childId}`, pathRef: "worktree.yaml", parentTaskId: current.id, mainTaskId, mergeTarget: current.worktree?.branch || "main" },
    dependencies: { needs: [], provides: [`subtask:${current.id}:${childId}`], blockedBy: [], fileLocks: [], semaphores: [] }
  }, root));
  await writeTaskFile(child.id, "acceptance.md", `# Critérios de aceite\n\n- [ ] Request atendido: ${command.request}\n- [ ] Expected output entregue: ${command.expectedOutput || "result summary"}\n- [ ] Parent task id: ${current.id}\n- [ ] Main task id: ${mainTaskId}\n- [ ] Target persona: ${targetRole}\n`, root);
  const subtasksPath = `${paths(root).tasks}/${current.id}/subtasks.yaml`;
  const existing = await readYaml(subtasksPath, { schema: "kanban-code-agent/subtasks@2", taskId: current.id, parentTaskId: current.id, strategy: "dag", mergePolicy: "sequential-into-parent-feature", nodes: [], subtasks: [], edges: [] });
  const node = { id: child.id, title: child.title, status: child.status, column: child.column, role: targetRole, agent: agentId, needs: [], provides: child.dependencies?.provides || [], fileLocks: [], semaphores: [], parentTaskId: current.id, mainTaskId };
  const nodes = [...(existing.nodes || existing.subtasks || []), node];
  await writeYaml(subtasksPath, { ...existing, nodes, subtasks: nodes, edges: existing.edges || [] });
  await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, { ts: new Date().toISOString(), type: "delegation.subtask_created", actor: command.fromPersona, taskId: current.id, subtaskId: child.id, toPersona: targetRole, wait: command.wait });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: command.wait ? "waiting" : "queued",
    column: current.column,
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: command.fromPersona }
  }, root, "delegation.subtask_created"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task, subtask: child, delegation: { fromPersona: command.fromPersona, toPersona: command.toPersona, wait: command.wait } };
}
