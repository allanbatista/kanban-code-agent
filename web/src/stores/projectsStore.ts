import { create } from 'zustand';
import { api } from '@/api/client';
import { apiProjectToProject } from '@/api/adapter';
import type { Project } from '@/types/project';

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;

  fetchProjects: () => Promise<void>;
  createProject: (data: {
    name: string;
    slug?: string;
    description?: string;
    gitUrl?: string;
    defaultBranch?: string;
    autoMerge?: boolean;
    devcontainerPath?: string;
  }) => Promise<Project>;
  updateProject: (id: string, data: {
    name?: string;
    description?: string;
    gitUrl?: string;
    defaultBranch?: string;
    autoMerge?: boolean;
    devcontainerPath?: string | null;
  }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  getProjectById: (id: string) => Project | undefined;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getProjects();
      const projects = response.projects.map((p) => apiProjectToProject(p));
      set({ projects, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createProject: async (data) => {
    const apiProject = await api.createProject(data);
    const project = apiProjectToProject(apiProject);
    set((state) => ({ projects: [...state.projects, project] }));
    return project;
  },

  updateProject: async (id, data) => {
    await api.updateProject(id, data);
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, ...data } : p,
      ),
    }));
  },

  deleteProject: async (id) => {
    await api.deleteProject(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    }));
  },

  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),

  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    })),

  getProjectById: (id) => get().projects.find((p) => p.id === id),
}));
