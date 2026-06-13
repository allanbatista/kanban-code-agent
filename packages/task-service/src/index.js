import { normalizeColumnId } from "@kca/fsdb";
import { createFsdbRepositories } from "@kca/fsdb/repositories";
import { roleById } from "@kca/core/roles";
import { logStep } from "@kca/core/log";
import { TaskSchema } from "@kca/schemas";

function roleColumn(roleId) {
  if (roleId === "done") return "done";
  return roleById(roleId)?.columnIds?.[0] || normalizeColumnId(roleId);
}

function roleAgent(roleId) {
  return roleById(roleId)?.agentId || roleId;
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
    const snapshot = this.boardService ? await this.boardService.snapshot() : await this.repositories.board.snapshot();
    const requestedColumn = snapshot.columns.some((column) => column.id === toColumn) ? toColumn : normalizeColumnId(toColumn);
    if (requestedColumn === current.column) {
      const task = TaskSchema.parse(current);
      await this.publish("TaskMoveNoop", { taskId, toColumn: task.column, task });
      return { task, hooks: [], noop: true };
    }
    if (["running", "interrupting"].includes(current.status)) {
      await this.repositories.tasks.save(taskId, {
        routing: { ...current.routing, manualOverride: { active: true, lastManualMoveAt: new Date().toISOString(), invalidatesRunId: current.agent?.currentRunId || null } }
      }, "task.move_requested");
    }
    let task = TaskSchema.parse(await this.repositories.tasks.move(taskId, toColumn));
    const targetColumn = snapshot.columns.find((column) => column.id === task.column);
    if (task.column === "inbox") {
      task = TaskSchema.parse(await this.repositories.tasks.save(taskId, {
        status: "idle",
        dependencies: { ...task.dependencies, blockedBy: [] },
        routing: {
          ...task.routing,
          currentAgent: null,
          currentRole: null,
          nextSuggestedColumn: null,
          manualOverride: { ...(task.routing?.manualOverride || {}), active: false }
        }
      }, "task.unassigned"));
    } else if (targetColumn?.autoStart && ["draft", "idle", "queued", "running", "interrupting", "waiting_human", "blocked", "failed"].includes(task.status)) {
      task = TaskSchema.parse(await this.repositories.tasks.save(taskId, {
        status: "queued",
        dependencies: { ...task.dependencies, blockedBy: [] },
        routing: {
          ...task.routing,
          currentAgent: targetColumn.agent || task.routing?.currentAgent,
          currentRole: targetColumn.role || targetColumn.agent || task.routing?.currentRole,
          manualOverride: { ...(task.routing?.manualOverride || {}), active: false }
        }
      }, "agent.queued"));
    }
    const hooks = typeof runHooks === "function" ? await runHooks(task, "onColumnEnter") : [];
    await this.publish("TaskMoved", { taskId, toColumn: task.column, task });
    return { task, hooks };
  }

  async answerInput(taskId, answer, returnRole) {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    const role = returnRole || current.routing?.lastRole || "manager";
    await this.repositories.events.appendTaskEvent(taskId, { ts: new Date().toISOString(), type: "human.input_received", actor: "user", taskId, answer });
    const task = await this.updateTask(taskId, {
      status: "queued",
      column: roleColumn(role),
      routing: { ...current.routing, currentAgent: roleAgent(role), currentRole: role },
      dependencies: { ...current.dependencies, blockedBy: [] }
    }, "task.unblocked");
    return task;
  }

  async routeTask(taskId, role) {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    return this.updateTask(taskId, {
      status: "queued",
      column: roleColumn(role),
      routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: roleAgent(role), currentRole: role }
    }, "role.handoff");
  }

  async blockTask(taskId, blocker, eventType = "task.blocked") {
    const current = await this.repositories.tasks.findById(taskId);
    if (!current) throw new Error(`Task not found: ${taskId}`);
    return this.updateTask(taskId, {
      status: "queued",
      column: "manager",
      routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: current.routing?.currentRole || null, currentAgent: "manager", currentRole: "manager" },
      dependencies: { ...current.dependencies, blockedBy: [] }
    }, eventType);
  }
}

export function createTaskService(root, options = {}) {
  return new TaskService({ root, ...options });
}
