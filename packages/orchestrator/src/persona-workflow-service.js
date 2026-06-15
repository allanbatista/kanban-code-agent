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
  const fromRole = current.routing?.currentRole || current.routing?.currentAgent || "assistant";
  return delegateTaskWorkflow({
    type: "agent.delegate_task",
    commandId: command.commandId,
    taskId: command.taskId,
    runId: command.runId,
    fromPersona: fromRole,
    toPersona: command.targetRole,
    wait: true,
    request: command.question,
    expectedOutput: command.expectedArtifact || "Report result to parent task."
  }, current, root);
}

export async function waitForHumanWorkflow(command, current, root) {
  logStep("agent", "wait.human", { taskId: command.taskId, runId: command.runId, question: command.question });
  const relativePath = `summaries/input-${Date.now()}.md`;
  await writeTaskFile(command.taskId, relativePath, `# Input solicitado\n\n${command.question}\n\n${(command.options || []).map((option) => `- ${option}`).join("\n")}\n`, root);
  const requester = command.requestedByRole || current.routing?.currentRole || current.routing?.currentAgent || "assistant";
  const message = await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: requester, agentId: current.routing?.currentAgent || requester, runId: command.runId, disposition: "wait_for_human", text: command.question, visibility: "both" });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "waiting_human",
    column: current.column,
    routing: current.routing,
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
  const mainTaskId = current.rootTaskId || current.worktree?.mainTaskId || current.worktree?.parentTaskId || current.id;
  const childDepth = (Number.isInteger(current.depth) ? current.depth : current.parentTaskId || current.worktree?.parentTaskId ? 1 : 0) + 1;
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
    parentTaskId: current.id,
    rootTaskId: mainTaskId,
    depth: childDepth,
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
  const node = { id: child.id, title: child.title, status: child.status, column: child.column, role: targetRole, agent: agentId, needs: [], provides: child.dependencies?.provides || [], fileLocks: [], semaphores: [], parentTaskId: current.id, mainTaskId, rootTaskId: mainTaskId, depth: childDepth };
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
