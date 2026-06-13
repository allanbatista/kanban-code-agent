export function createMemoryRepositories(seed = {}) {
  const tasks = new Map((seed.tasks || []).map((task) => [task.id, structuredClone(task)]));
  const runtimeEvents = [];
  const taskEvents = new Map();
  const settings = seed.settings || { runtime: { maxParallelTasks: 3, agentTokens: {}, projectTokens: {} } };
  const board = seed.board || { columns: [] };
  const commandResults = new Map();

  return {
    tasks: {
      findById: async (taskId) => tasks.get(taskId) || null,
      list: async () => [...tasks.values()].map((task) => structuredClone(task)),
      exists: async (taskId) => tasks.has(taskId),
      create: async (input) => {
        const now = new Date().toISOString();
        const task = {
          schema: "kanban-code-agent/task@1",
          id: input.id || `KCA-${tasks.size + 1}`,
          title: input.title,
          kind: input.kind || "task",
          column: input.column || "manager",
          status: input.status || "idle",
          priority: input.priority || "medium",
          createdAt: now,
          updatedAt: now,
          createdBy: "user",
          projectTargets: input.projectTargets || [],
          routing: input.routing || { currentAgent: input.agent || "manager", currentRole: input.role || input.agent || "manager", manualOverride: { active: false } },
          worktree: input.worktree || { enabled: true, kind: input.kind || "task", branch: `kca/KCA-${tasks.size + 1}`, parentTaskId: null, mergeTarget: "main" },
          dependencies: input.dependencies || { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
          hooks: input.hooks || { active: [] },
          skills: input.skills || { active: [] },
          tags: input.tags || []
        };
        tasks.set(task.id, task);
        return structuredClone(task);
      },
      save: async (taskId, patch) => {
        const task = { ...tasks.get(taskId), ...patch, updatedAt: new Date().toISOString() };
        tasks.set(taskId, task);
        return structuredClone(task);
      },
      move: async (taskId, column) => {
        const task = { ...tasks.get(taskId), column, updatedAt: new Date().toISOString() };
        tasks.set(taskId, task);
        return structuredClone(task);
      }
    },
    artifacts: {
      readFile: async () => "",
      writeFile: async (_taskId, path) => path,
      listFiles: async () => [],
      readTaskFiles: async (taskId) => ({ taskId, acceptance: "", description: "", planning: null, subtasks: null, events: taskEvents.get(taskId) || [], files: [] })
    },
    board: {
      getDefaultBoard: async () => board,
      snapshot: async () => ({ schema: "kanban-code-agent/state@1", columns: board.columns || [], tasks: [...tasks.values()], settings, events: runtimeEvents }),
      saveBoard: async (next) => Object.assign(board, next)
    },
    settings: {
      readScope: async () => settings,
      updateScope: async (_scope, patch) => Object.assign(settings, patch),
      readAll: async () => settings
    },
    events: {
      appendTaskEvent: async (taskId, event) => taskEvents.set(taskId, [...(taskEvents.get(taskId) || []), event]),
      appendRuntimeEvent: async (event) => runtimeEvents.push(event),
      listTaskEvents: async (taskId) => taskEvents.get(taskId) || [],
      listRuntimeEvents: async () => runtimeEvents
    },
    commandResults: {
      get: async (commandId) => commandResults.get(commandId) || null,
      put: async (commandId, result) => {
        commandResults.set(commandId, result);
        return result;
      }
    },
    semaphores: {
      readState: async () => ({ schema: "kanban-code-agent/semaphores@1", tokens: {}, leases: [] }),
      acquire: async () => ({ ok: true, leases: [] }),
      release: async () => ({ ok: true })
    }
  };
}
