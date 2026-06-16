import { create } from 'zustand';
import type { Task, TaskStatus } from '@/types/task';
import { MOCK_TASKS } from '@/mocks/mockTasks';

interface KanbanState {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus) => void;
  moveTask: (taskId: string, newAgent: string) => void;
  addTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
  getTasksByAgent: (agentId: string) => Task[];
  getTaskById: (id: string) => Task | undefined;
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  tasks: MOCK_TASKS,

  setTasks: (tasks) => set({ tasks }),

  updateTaskStatus: (taskId, status) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status } : t
      ),
    })),

  moveTask: (taskId, newAgent) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, assignedTo: newAgent, status: 'PENDING' as TaskStatus } : t
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
}));
