import { create } from 'zustand';
import { api } from '@/api/client';
import { apiTaskToTask, apiAgentToAgent } from '@/api/adapter';
import type { Task, TaskStatus, Agent as UIAgent } from '@/types/task';

interface KanbanState {
  tasks: Task[];
  agents: UIAgent[];
  familyColors: Record<string, string>;
  loading: boolean;
  error: string | null;
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  fetchTasks: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  createTask: (data: {
    message: string;
    runtimeConfig?: { model?: string; effort?: string };
    execute?: boolean;
  }) => Promise<Task>;
  cancelTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  moveTask: (taskId: string, newAgent: string) => Promise<void>;
  sendMessage: (taskId: string, message: string) => Promise<void>;
  archiveColumn: (status: string) => Promise<void>;

  setTasks: (tasks: Task[]) => void;
  upsertTask: (task: Task) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  setFamilyColor: (rootId: string, color: string) => void;
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById: (id: string) => Task | undefined;
  getTaskRootId: (taskId: string) => string;
  getFamilyTasks: (rootId: string) => string[];
}

function findRootId(taskId: string, tasks: Task[]): string {
  const parentMap = new Map<string, string>();
  for (const t of tasks) {
    for (const subId of t.subtaskIds) {
      parentMap.set(subId, t.id);
    }
  }
  let current = taskId;
  while (parentMap.has(current)) {
    current = parentMap.get(current)!;
  }
  return current;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Provisional card shown while the create request is in flight. The backend
// generates the real title; here we use the message as a placeholder.
function makeOptimisticTask(
  id: string,
  data: { message: string; runtimeConfig?: { model?: string; effort?: string }; execute?: boolean },
): Task {
  const title = data.message.trim().split('\n')[0]?.slice(0, 80) || 'Nova tarefa';
  return {
    id,
    title,
    assignedTo: data.execute ? 'manager' : 'inbox',
    status: 'PENDING',
    depth: 0,
    subtaskIds: [],
    runtimeConfig: { model: data.runtimeConfig?.model ?? 'balanced', effort: data.runtimeConfig?.effort ?? 'medium' },
    chat: [{ ts: new Date().toISOString(), role: 'user', type: 'text', text: data.message }],
    artifacts: [],
    attachments: [],
    metrics: {
      durationMs: 0,
      waitingMs: 0,
      tokens: { input: 0, output: 0, total: 0, cache: 0 },
      cost: 0,
    },
    retryCount: 0,
    runs: [],
  };
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  tasks: [],
  agents: [],
  familyColors: {},
  loading: false,
  error: null,
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getTasks();
      const tasks = response.tasks.map(apiTaskToTask);
      set({ tasks, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  fetchAgents: async () => {
    try {
      const response = await api.getAgents();
      const agents = response.agents.map(apiAgentToAgent);
      set({ agents });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  createTask: async (data) => {
    // Optimistic: show the card immediately, then reconcile / roll back.
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = makeOptimisticTask(tempId, data);
    set((state) => ({ tasks: [...state.tasks, optimistic], error: null }));
    try {
      const apiTask = await api.createTask(data);
      const task = apiTaskToTask(apiTask);
      // Drop the temp card and any copy the WS stream may have already inserted,
      // then append once — prevents duplicate keys when both races land.
      set((state) => ({
        tasks: [...state.tasks.filter((t) => t.id !== tempId && t.id !== task.id), task],
      }));
      return task;
    } catch (err) {
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== tempId),
        error: errorMessage(err),
      }));
      throw err;
    }
  },

  cancelTask: async (taskId) => {
    // Optimistic: flip to CANCELLED, restore the previous status on failure.
    const prev = get().tasks.find((t) => t.id === taskId)?.status;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'CANCELLED' as TaskStatus } : t,
      ),
      error: null,
    }));
    try {
      await api.cancelTask(taskId);
    } catch (err) {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId && prev ? { ...t, status: prev } : t,
        ),
        error: errorMessage(err),
      }));
      throw err;
    }
  },

  completeTask: async (taskId) => {
    // Optimistic: flip to COMPLETED, restore the previous status on failure.
    const prev = get().tasks.find((t) => t.id === taskId)?.status;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'COMPLETED' as TaskStatus } : t,
      ),
      error: null,
    }));
    try {
      await api.updateTask(taskId, { status: 'COMPLETED' });
    } catch (err) {
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId && prev ? { ...t, status: prev } : t,
        ),
        error: errorMessage(err),
      }));
      throw err;
    }
  },

  sendMessage: async (taskId, message) => {
    const result = await api.sendMessage(taskId, message);
    get().upsertTask(apiTaskToTask(result));
  },

  archiveColumn: async (status) => {
    await api.archiveColumn(status);
    set((state) => ({
      tasks: state.tasks.filter((t) => !(!t.parentId && t.status === status)),
    }));
  },

  moveTask: async (taskId, newAgent) => {
    // Users may only park (inbox) or execute (manager). Other drops are ignored.
    if (newAgent !== 'inbox' && newAgent !== 'manager') return;
    const prev = get().tasks.find((t) => t.id === taskId);
    if (!prev || prev.assignedTo === newAgent) return;

    // Optimistic move, reconciled / rolled back against the backend.
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, assignedTo: newAgent, status: 'PENDING' as TaskStatus } : t,
      ),
      error: null,
    }));
    try {
      await api.updateTask(taskId, { assignedTo: newAgent });
    } catch (err) {
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === taskId ? prev : t)),
        error: errorMessage(err),
      }));
      throw err;
    }
  },

  setTasks: (tasks) => set({ tasks }),

  upsertTask: (task) =>
    set((state) => ({
      tasks: state.tasks.some((t) => t.id === task.id)
        ? state.tasks.map((t) => (t.id === task.id ? task : t))
        : [...state.tasks, task],
    })),

  updateTaskStatus: (taskId, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status } : t,
      ),
    })),

  addTask: (task) =>
    set((state) => ({ tasks: [...state.tasks, task] })),

  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    })),

  getTasksByAgent: (agentId) => get().tasks.filter((t) => t.assignedTo === agentId),

  getTaskById: (id) => get().tasks.find((t) => t.id === id),

  setFamilyColor: (rootId, color) =>
    set((state) => ({
      familyColors: { ...state.familyColors, [rootId]: color },
    })),

  getTaskRootId: (taskId) => findRootId(taskId, get().tasks),

  getFamilyTasks: (rootId) => {
    const { tasks } = get();
    const result: string[] = [rootId];
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const task = tasks.find((t) => t.id === id);
      if (task) {
        for (const subId of task.subtaskIds) {
          result.push(subId);
          queue.push(subId);
        }
      }
    }
    return result;
  },
}));
