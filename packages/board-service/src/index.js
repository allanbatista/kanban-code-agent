import { buildAgentChat } from "@kca/agent-runtime";
import { discoverProviders } from "@kca/core/providers";
import { logStep } from "@kca/core/log";
import { readAgentLogs } from "@kca/fsdb";
import { readChatHistory, readTaskComments } from "@kca/fsdb/chat-store";
import { createFsdbRepositories } from "@kca/fsdb/repositories";
import { TaskSchema } from "@kca/schemas";
import { BoardProjection } from "./projection.js";

export class BoardService {
  constructor({ root, repositories, projection } = {}) {
    this.root = root;
    this.repositories = repositories || createFsdbRepositories(root);
    this.projection = projection || new BoardProjection({ repository: this.repositories.board });
  }

  invalidate(reason = "manual") {
    logStep("board-service", "projection.invalidate", { reason });
    this.projection.invalidate();
  }

  async snapshot() {
    logStep("board-service", "snapshot.start");
    const result = await this.projection.snapshot();
    logStep("board-service", "snapshot.done", { tasks: result.tasks?.length || 0 });
    return result;
  }

  async taskDetail(taskId) {
    logStep("board-service", "taskDetail.start", { taskId });
    const task = await this.repositories.tasks.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return TaskSchema.parse(task);
  }

  taskFiles(taskId) {
    logStep("board-service", "taskFiles", { taskId });
    return this.repositories.artifacts.readTaskFiles(taskId);
  }

  async orchestratorStatus({ semaphoreState } = {}) {
    logStep("board-service", "orchestratorStatus.start");
    const [tasks, settings, semaphores] = await Promise.all([
      this.repositories.tasks.list(),
      this.repositories.settings.readAll(),
      semaphoreState ? Promise.resolve(semaphoreState) : this.repositories.semaphores.readState()
    ]);
    const running = tasks.filter((task) => task.status === "running");
    const queued = tasks.filter((task) => task.status === "queued");
    const mergePending = tasks.filter((task) => task.status === "merge_pending");
    const blocked = tasks.filter((task) => task.status === "blocked");
    const result = {
      schema: "kanban-code-agent/orchestrator-status@1",
      capacity: {
        running: running.length,
        maxParallelTasks: settings.runtime?.maxParallelTasks ?? 3,
        maxParallelMerges: settings.runtime?.maxParallelMerges ?? 1,
        agentTokens: settings.runtime?.agentTokens || {},
        projectTokens: settings.runtime?.projectTokens || {}
      },
      queue: queued.map((task) => task.id),
      running: running.map((task) => ({ id: task.id, agent: task.routing?.currentAgent || task.agent?.currentAgent || task.agent || "assistant" })),
      merges: mergePending.map((task) => task.id),
      worktrees: tasks.filter((task) => task.worktree?.enabled).map((task) => ({ taskId: task.id, branch: task.worktree?.branch, path: task.worktree?.path })),
      blockers: blocked.map((task) => ({ taskId: task.id, title: task.title, blockedBy: task.dependencies?.blockedBy || [] })),
      semaphores
    };
    logStep("board-service", "orchestratorStatus.done", { running: result.capacity.running, queued: result.queue.length });
    return result;
  }

  chatHistory(query) {
    return readChatHistory(this.root, query);
  }

  taskComments(query) {
    return readTaskComments(this.root, query);
  }

  agentLogs(query) {
    return readAgentLogs(this.root, query);
  }

  settingsScope(scope) {
    return this.repositories.settings.readScope(scope);
  }

  providerDiscover() {
    return discoverProviders();
  }

  async chatBuild(query, buildChat = buildAgentChat) {
    const task = await this.repositories.tasks.findById(query.taskId);
    if (!task) throw new Error(`Task not found: ${query.taskId}`);
    return buildChat(task, this.root, query);
  }
}

export function createBoardService(root, options = {}) {
  return new BoardService({ root, ...options });
}
