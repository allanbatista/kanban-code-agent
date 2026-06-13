import { validateDag } from "@kca/core/dag";
import { appendJsonl, createTask, paths, updateTask, writeYaml } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";

const LEGACY_ROLE_ALIASES = {
  architect: "architecture",
  engineer: "engineering",
  validator: "quality",
  reviewer: "review"
};

function canonicalRole(value, fallback = "engineering") {
  return LEGACY_ROLE_ALIASES[value] || value || fallback;
}

export async function decomposeTaskWorkflow(command, parent, root) {
  logStep("orchestrator", "task.decompose", { commandId: command.commandId, taskId: command.taskId });
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
  for (const [index, subtask] of subtasks.entries()) {
    const role = canonicalRole(subtask.role || subtask.agentId || subtask.agent, parent.routing?.currentRole || parent.routing?.currentAgent || "engineering");
    created.push(TaskSchema.parse(await createTask({
      id: subtask.id || `${parent.id}-${String(index + 1).padStart(2, "0")}`,
      title: subtask.title,
      kind: "subtask",
      column: "definition",
      status: "queued",
      projectTargets: parent.projectTargets,
      agent: role,
      role,
      worktree: { enabled: true, kind: "subtask", branch: `kca/${parent.id}-${index + 1}`, pathRef: "worktree.yaml", parentTaskId: parent.id, mergeTarget: parent.worktree?.branch || "main" },
      dependencies: { needs: subtask.needs || [], provides: subtask.provides || [], blockedBy: [], fileLocks: subtask.fileLocks || [], semaphores: [] }
    }, root)));
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
    mergeTarget: task.worktree?.mergeTarget
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
  return { ok: true, commandId: command.commandId, task: parent, subtasks: created };
}
