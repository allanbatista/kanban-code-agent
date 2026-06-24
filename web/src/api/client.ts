import type {
  ApiTask,
  ApiTaskListResponse,
  ApiAgent,
  ApiAgentListResponse,
  ApiProject,
  ApiProjectListResponse,
  ApiSettings,
  ApiHealth,
} from '@/types/api';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:35000';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? body.message ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

// --- Tasks ---

export const api = {
  getTasks(params?: { status?: string }): Promise<ApiTaskListResponse> {
    const query = params?.status ? `?status=${encodeURIComponent(params.status)}` : '';
    return request<ApiTaskListResponse>(`/api/tasks${query}`);
  },

  getTask(taskId: string): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}`);
  },

  createTask(data: {
    message: string;
    runtimeConfig?: { model?: string; effort?: string };
    attachmentPaths?: string[];
    execute?: boolean;
  }): Promise<ApiTask> {
    return request<ApiTask>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateTask(
    taskId: string,
    data: { status?: string; runtimeConfig?: { model?: string; effort?: string }; assignedTo?: 'inbox' | 'manager' },
  ): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  cancelTask(taskId: string): Promise<void> {
    return request<void>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
  },

  sendMessage(taskId: string, message: string): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  archiveColumn(status: string): Promise<{ archived: string[]; total: number }> {
    return request<{ archived: string[]; total: number }>('/api/tasks/archive', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },

  // --- Agents ---

  getAgents(): Promise<ApiAgentListResponse> {
    return request<ApiAgentListResponse>('/api/agents');
  },

  getAgent(name: string): Promise<ApiAgent> {
    return request<ApiAgent>(`/api/agents/${encodeURIComponent(name)}`);
  },

  updateAgent(
    name: string,
    data: { runtimeConfig?: { model?: string; effort?: string }; role?: string },
  ): Promise<ApiAgent> {
    return request<ApiAgent>(`/api/agents/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // --- Projects ---

  getProjects(): Promise<ApiProjectListResponse> {
    return request<ApiProjectListResponse>('/api/projects');
  },

  createProject(data: { name: string; description?: string }): Promise<ApiProject> {
    return request<ApiProject>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getProject(id: string): Promise<ApiProject> {
    return request<ApiProject>(`/api/projects/${encodeURIComponent(id)}`);
  },

  updateProject(
    id: string,
    data: { name?: string; description?: string; taskIds?: string[] },
  ): Promise<ApiProject> {
    return request<ApiProject>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteProject(id: string): Promise<void> {
    return request<void>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // --- Settings ---

  getSettings(): Promise<ApiSettings> {
    return request<ApiSettings>('/api/settings');
  },

  updateSettings(data: Record<string, unknown>): Promise<ApiSettings> {
    return request<ApiSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // --- Health ---

  health(): Promise<ApiHealth> {
    return request<ApiHealth>('/api/health');
  },
};
