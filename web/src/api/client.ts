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

// Same-origin by default (empty base = relative '/api/...'): in dev the Vite
// server proxies /api to the API; in production the API server serves the page.
// Set VITE_API_URL to target an absolute API host.
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function artifactUrl(taskId: string, path: string): string {
  return `${API_BASE}/api/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(fileNameOf(path))}`;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we actually send a body. Fastify
  // rejects an empty body when content-type is 'application/json' (a body-less
  // DELETE/POST would otherwise 400 with "Body cannot be empty").
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> | undefined) };
  if (options?.body != null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });

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
    projectIds?: string[];
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

  approveTask(taskId: string): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}/approve`, {
      method: 'POST',
    });
  },

  rejectTask(taskId: string, message: string): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}/reject`, {
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

  artifactUrl(taskId: string, path: string): string {
    return artifactUrl(taskId, path);
  },

  async getArtifactText(taskId: string, path: string): Promise<string> {
    const response = await fetch(artifactUrl(taskId, path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },

  updateArtifactText(taskId: string, path: string, content: string): Promise<ApiTask> {
    return request<ApiTask>(`/api/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(fileNameOf(path))}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
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

  createProject(data: {
    name: string;
    slug?: string;
    description?: string;
    gitUrl?: string;
    defaultBranch?: string;
    autoMerge?: boolean;
  }): Promise<ApiProject> {
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
    data: { name?: string; description?: string; gitUrl?: string; defaultBranch?: string; autoMerge?: boolean },
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
