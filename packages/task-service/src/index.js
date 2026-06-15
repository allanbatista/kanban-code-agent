import { createFsdbRepositories } from "@kca/fsdb/repositories";
import { logStep } from "@kca/core/log";
import { TaskSchema } from "@kca/schemas";

const OPERATIONAL_MOVE_COLUMNS = new Set(["inbox", "manager", "done"]);
const OPERATIONAL_COLUMN_ALIASES = { entrada: "inbox", pronto: "done" };

function normalizeOperationalColumn(column) {
  return OPERATIONAL_COLUMN_ALIASES[column] || column;
}

function canMoveOperationalColumn(fromColumn, toColumn) {
  return OPERATIONAL_MOVE_COLUMNS.has(normalizeOperationalColumn(fromColumn)) && OPERATIONAL_MOVE_COLUMNS.has(normalizeOperationalColumn(toColumn));
}

function operationalMovePatch(current, toColumn) {
  const column = normalizeOperationalColumn(toColumn);
  if (!canMoveOperationalColumn(current.column, column)) return null;
  if (column === "done") {
    return {
      column,
      status: "done",
      routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: null, currentRole: null }
    };
  }
  if (column === "manager") {
    return {
      column,
      status: "queued",
      routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } }
    };
  }
  return {
    column,
    status: "idle",
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: null, currentRole: null, manualOverride: { active: false } }
  };
}

function fallbackTitle(input = {}) {
  const title = String(input.title || "").trim();
  if (title) return title;
  const description = String(input.description || "").replace(/[#*_>`[\]()!-]/g, " ").split("\n").map((line) => line.trim()).find(Boolean);
  return (description || "Rascunho sem titulo").slice(0, 80);
}

export class TaskService {
  constructor({ root, repositories, boardService, eventBus } = {}) {
    this.root = root;
    this.repositories = repositories || createFsdbRepositories(root);
    this.boardService = boardService;
    this.eventBus = eventBus;
  }

  async publish(type, payload) {
    await this.eventBus?.publish?.({ type, ...payload });
    this.boardService?.invalidate?.(type);
  }

  async createTask(input) {
    logStep("task-service", "createTask", { title: input.title });
    let task = TaskSchema.parse(await this.repositories.tasks.create(input));
    const snapshot = this.boardService ? await this.boardService.snapshot() : await this.repositories.board.snapshot();
    const targetColumn = snapshot.columns.find((column) => column.id === task.column);
    if (targetColumn?.autoStart && ["idle", "queued"].includes(task.status)) {
      task = TaskSchema.parse(await this.repositories.tasks.save(task.id, {
        status: "queued",
        routing: {
          ...task.routing,
          currentAgent: targetColumn.agent || task.routing?.currentAgent,
          currentRole: targetColumn.role || targetColumn.agent || task.routing?.currentRole
        }
      }, "agent.queued"));
    }
    await this.publish("TaskCreated", { taskId: task.id, task });
    return task;
  }

  async updateTask(taskId, patch, eventType = "task.updated") {
    logStep("task-service", "updateTask", { taskId, eventType });
    const normalizedPatch = Object.hasOwn(patch || {}, "title") ? { ...patch, title: fallbackTitle(patch) } : patch;
    const task = TaskSchema.parse(await this.repositories.tasks.save(taskId, normalizedPatch, eventType));
    await this.publish("TaskUpdated", { taskId, patch, task });
    return task;
  }

  async writeTaskFile(taskId, path, content) {
    logStep("task-service", "writeTaskFile", { taskId, path });
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    const filePath = await this.repositories.artifacts.writeFile(taskId, path, content);
    await this.repositories.events.appendTaskEvent(taskId, { ts: new Date().toISOString(), type: "task.file.updated", actor: "user", taskId, path: filePath });
    await this.publish("TaskFileUpdated", { taskId, path: filePath });
    return { task: TaskSchema.parse(current), path: filePath };
  }

  async writeTaskAttachment(taskId, fileName, contentType, dataBase64) {
    logStep("task-service", "writeTaskAttachment", { taskId, fileName, contentType });
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    const filePath = await this.repositories.artifacts.writeAttachment(taskId, fileName, Buffer.from(dataBase64, "base64"));
    await this.repositories.events.appendTaskEvent(taskId, { ts: new Date().toISOString(), type: "task.attachment.created", actor: "user", taskId, path: filePath, fileName, contentType });
    await this.publish("TaskAttachmentCreated", { taskId, path: filePath });
    return { task: TaskSchema.parse(current), path: filePath };
  }

  async moveTask(taskId, toColumn, { runHooks } = {}) {
    logStep("task-service", "moveTask.start", { taskId, toColumn });
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    const targetColumn = normalizeOperationalColumn(toColumn);
    if (current.column === targetColumn) return { task: TaskSchema.parse(current), hooks: [], noop: true };
    const patch = operationalMovePatch(current, targetColumn);
    if (!patch) {
      const task = TaskSchema.parse(current);
      await this.publish("TaskMoveUnsupported", { taskId, toColumn, task });
      return { task, hooks: [], noop: true, unsupported: true };
    }
    const task = await this.updateTask(taskId, patch, "task.moved");
    await this.publish("TaskMoved", { taskId, fromColumn: current.column, toColumn: targetColumn, task });
    return { task, hooks: [], noop: current.column === task.column };
  }

  async answerInput(taskId, answer, returnRole) {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    await this.repositories.events.appendTaskEvent(taskId, { ts: new Date().toISOString(), type: "human.input_received", actor: "user", taskId, answer });
    const task = await this.updateTask(taskId, {
      status: "queued",
      column: current.column,
      routing: current.routing,
      dependencies: { ...current.dependencies, blockedBy: [] }
    }, "task.unblocked");
    return task;
  }

  async routeTask(taskId, role) {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    return TaskSchema.parse(current);
  }

  async blockTask(taskId, blocker, eventType = "task.blocked") {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    return this.updateTask(taskId, {
      status: "blocked",
      column: current.column,
      routing: current.routing,
      dependencies: { ...current.dependencies, blockedBy: [] }
    }, eventType);
  }
}

export function createTaskService(root, options = {}) {
  return new TaskService({ root, ...options });
}
