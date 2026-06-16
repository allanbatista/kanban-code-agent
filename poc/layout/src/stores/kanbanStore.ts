import { create } from 'zustand';
import type { Task, TaskStatus } from '@/types/task';
import { MOCK_TASKS } from '@/mocks/mockTasks';

interface KanbanState {
  tasks: Task[];
  familyColors: Record<string, string>;
  setTasks: (tasks: Task[]) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  moveTask: (taskId: string, newAgent: string) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  setFamilyColor: (rootId: string, color: string) => void;
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById: (id: string) => Task | undefined;
  getTaskRootId: (taskId: string) => string;
  getFamilyTasks: (rootId: string) => string[];
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  tasks: MOCK_TASKS,
  familyColors: {},

  setTasks: (tasks) => set({ tasks }),

  updateTaskStatus: (taskId, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status } : t
      ),
    })),

  moveTask: (taskId, newAgent) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        if (newAgent === 'done') return { ...t, assignedTo: newAgent, status: 'COMPLETED' as TaskStatus };
        return { ...t, assignedTo: newAgent, status: 'PENDING' as TaskStatus };
      }),
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

  getTaskRootId: (taskId) => {
    const { tasks } = get();
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
  },

  getFamilyTasks: (rootId) => {
    const { tasks } = get();
    const result: string[] = [rootId];
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const task = tasks.find(t => t.id === id);
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
