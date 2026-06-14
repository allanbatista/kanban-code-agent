import { validateDag } from "@kca/core/dag";
import { appendJsonl, createTask, listTasks, paths, updateTask, writeTaskFile, writeYaml } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";
import { roleById } from "@kca/core/roles";

const LEGACY_ROLE_ALIASES = {
  architect: "architecture",
  engineer: "engineering",
  validator: "quality",
  reviewer: "review"
};

function canonicalRole(value, fallback = "engineering") {
  return LEGACY_ROLE_ALIASES[value] || value || fallback;
}

function roleColumn(roleId) {
  return roleById(roleId)?.columnIds?.[0] || roleId;
}

function subtaskDescription(parent, subtask, role, mainTaskId) {
  return [
    subtask.description || subtask.request || `Execute esta subtask: ${subtask.title}.`,
    `Parent task id: ${parent.id}`,
    `Main task id: ${mainTaskId}`,
    `Target role: ${role}`,
    `Expected output: ${subtask.expectedOutput || subtask.output || "Resultado próprio e verificável para consolidação no parent."}`,
    `Needs: ${(subtask.needs || []).join(", ") || "none"}`,
    `Provides: ${(subtask.provides || []).join(", ") || "none"}`
  ].join("\n\n");
}

function subtaskAcceptance(parent, subtask, role, mainTaskId) {
  const criteria = Array.isArray(subtask.acceptanceCriteria) ? subtask.acceptanceCriteria : [];
  const lines = criteria.length ? criteria : [
    `Output atende a subtask: ${subtask.title}`,
    `Resultado pode ser reportado ao parent ${parent.id}`,
    `mainTaskId correto: ${mainTaskId}`,
    `parentTaskId correto: ${parent.id}`,
    `Role responsável: ${role}`
  ];
  return `# Critérios de aceite\n\n${lines.map((line) => `- [ ] ${line}`).join("\n")}\n`;
}

export async function decomposeTaskWorkflow(command, parent, root) {
  logStep("orchestrator", "task.decompose", { commandId: command.commandId, taskId: command.taskId });
  const existingDirectSubtasks = (await listTasks(root)).filter((task) => task.worktree?.parentTaskId === parent.id);
  if (existingDirectSubtasks.length) {
    const pending = existingDirectSubtasks.filter((task) => task.status !== "done");
    const status = pending.length ? "waiting" : "done";
    const column = pending.length ? parent.column : "done";
    await appendChatMessage(root, {
      scope: "task",
      taskId: parent.id,
      role: "assistant",
      persona: "orchestrator",
      agentId: "orchestrator",
      disposition: "subtasks.existing",
      text: pending.length
        ? `Parent ja possui ${existingDirectSubtasks.length} subtasks diretas; aguardando pendentes: ${pending.map((task) => task.id).join(", ")}.`
        : `Parent ja possui ${existingDirectSubtasks.length} subtasks diretas concluidas; consolide os resultados sem criar novas subtasks.`,
      visibility: "both"
    });
    await appendJsonl(`${paths(root).tasks}/${parent.id}/events.jsonl`, { ts: new Date().toISOString(), type: "subtasks.existing", actor: "orchestrator", taskId: parent.id, subtasks: existingDirectSubtasks.map((task) => task.id), pending: pending.map((task) => task.id) });
    const task = TaskSchema.parse(await updateTask(parent.id, { status, column }, root, "subtasks.existing"));
    return { ok: true, commandId: command.commandId, task, subtasks: existingDirectSubtasks };
  }
  const subtasks = command.subtasks?.length ? command.subtasks : [
    { title: `${parent.title}: implementação`, needs: parent.dependencies?.needs || [], provides: [`subtask:${parent.id}:implementation`], fileLocks: parent.dependencies?.fileLocks || [], role: "engineering" },
    { title: `${parent.title}: validação`, needs: [`subtask:${parent.id}:implementation`], provides: [`subtask:${parent.id}:validation`], fileLocks: [], role: "quality" }
  ];
  const plannedNodes = subtasks.map((subtask, index) => ({
    id: subtask.id || `${parent.id}-${String(index + 1).padStart(2, "0")}`,
    title: subtask.title,
    role: canonicalRole(subtask.role || subtask.agentId || subtask.agent, parent.routing?.currentRole || parent.routing?.currentAgent || "engineering"),
    needs: subtask.needs || [],
    provides: subtask.provides || [],
    fileLocks: subtask.fileLocks || [],
    semaphores: subtask.semaphores || []
  }));
  const plannedDag = validateDag(plannedNodes);
  if (!plannedDag.ok) {
    const reason = `Invalid subtask DAG: ${JSON.stringify(plannedDag.errors)}`;
    await appendChatMessage(root, { scope: "task", taskId: parent.id, role: "assistant", persona: "manager", agentId: "manager", disposition: "task.decompose.failed", text: reason, visibility: "both" });
    const task = TaskSchema.parse(await updateTask(parent.id, {
      status: "queued",
      column: "manager",
      routing: { ...parent.routing, lastAgent: parent.routing?.currentAgent || null, lastRole: parent.routing?.currentRole || null, currentAgent: "manager", currentRole: "manager" },
      dependencies: { ...parent.dependencies, blockedBy: [] }
    }, root, "task.problem"));
    await appendJsonl(`${paths(root).tasks}/${parent.id}/events.jsonl`, { ts: new Date().toISOString(), type: "task.decompose.failed", actor: "orchestrator", taskId: parent.id, errors: plannedDag.errors });
    return { ok: false, commandId: command.commandId, task, subtasks: [], errors: plannedDag.errors };
  }
  const created = [];
  const mainTaskId = parent.worktree?.mainTaskId || parent.worktree?.parentTaskId || parent.id;
  for (const [index, subtask] of subtasks.entries()) {
    const role = canonicalRole(subtask.role || subtask.agentId || subtask.agent, parent.routing?.currentRole || parent.routing?.currentAgent || "engineering");
    const createdTask = TaskSchema.parse(await createTask({
      id: subtask.id || `${parent.id}-${String(index + 1).padStart(2, "0")}`,
      title: subtask.title,
      kind: "subtask",
      column: roleColumn(role),
      status: "queued",
      projectTargets: parent.projectTargets,
      agent: role,
      role,
      description: subtaskDescription(parent, subtask, role, mainTaskId),
      worktree: { enabled: true, kind: "subtask", branch: `kca/${parent.id}-${index + 1}`, pathRef: "worktree.yaml", parentTaskId: parent.id, mainTaskId, mergeTarget: parent.worktree?.branch || "main" },
      dependencies: { needs: subtask.needs || [], provides: subtask.provides || [], blockedBy: [], fileLocks: subtask.fileLocks || [], semaphores: [] }
    }, root));
    await writeTaskFile(createdTask.id, "acceptance.md", subtaskAcceptance(parent, subtask, role, mainTaskId), root);
    created.push(createdTask);
  }
  await appendJsonl(`${paths(root).tasks}/${parent.id}/events.jsonl`, { ts: new Date().toISOString(), type: "subtasks.spawned", actor: "orchestrator", taskId: parent.id, subtasks: created.map((task) => task.id) });
  const nodes = created.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    column: task.column,
    role: task.routing?.currentAgent || task.agent || null,
    agent: task.routing?.currentAgent || task.agent || null,
    needs: task.dependencies?.needs || [],
    provides: task.dependencies?.provides || [],
    fileLocks: task.dependencies?.fileLocks || [],
    semaphores: task.dependencies?.semaphores || [],
    branch: task.worktree?.branch,
    mergeTarget: task.worktree?.mergeTarget,
    parentTaskId: parent.id,
    mainTaskId
  }));
  await writeYaml(`${paths(root).tasks}/${parent.id}/subtasks.yaml`, {
    schema: "kanban-code-agent/subtasks@2",
    taskId: parent.id,
    parentTaskId: parent.id,
    strategy: "dag",
    mergePolicy: "sequential-into-parent-feature",
    nodes,
    subtasks: nodes,
    edges: plannedDag.edges
  });
  const task = TaskSchema.parse(await updateTask(parent.id, { status: "waiting", column: parent.column }, root, "subtasks.spawned"));
  return { ok: true, commandId: command.commandId, task, subtasks: created };
}
