import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Dynamic import after setting env
beforeEach(() => {
  mockFetch.mockReset();
});

async function getApiModule() {
  return import("@/api/client");
}

describe("api client (T02)", () => {
  it("getTasks returns task list", async () => {
    const mockResponse = { tasks: [], total: 0 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    const { api } = await getApiModule();
    const result = await api.getTasks();
    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks"),
      expect.any(Object)
    );
  });

  it("getTasks with status filter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tasks: [], total: 0 }),
    });
    const { api } = await getApiModule();
    await api.getTasks({ status: "RUNNING" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("status=RUNNING"),
      expect.any(Object)
    );
  });

  it("createTask sends POST with message", async () => {
    const mockTask = { taskId: "t1", title: "test", assignedTo: "inbox" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockTask),
    });
    const { api } = await getApiModule();
    const result = await api.createTask({ message: "test" });
    expect(result).toEqual(mockTask);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("test"),
      })
    );
  });

  it("getAgents returns agent list", async () => {
    const mockResponse = { agents: [], total: 0 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    const { api } = await getApiModule();
    const result = await api.getAgents();
    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/agents"),
      expect.any(Object)
    );
  });

  it("getProjects returns project list", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ projects: [], total: 0 }),
    });
    const { api } = await getApiModule();
    const result = await api.getProjects();
    expect(result).toEqual({ projects: [], total: 0 });
  });

  it("getSettings returns settings object", async () => {
    const mockSettings = {
      appearance: { theme: "dark", language: "pt-BR" },
      providers: [],
      advanced: { maxConcurrency: 3, runTimeoutMs: 300000, maxTaskDepth: 5, maxSubtasksPerTask: 10, maxRetries: 3, maxTechnicalRetries: 2, dataDir: ".swarm" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockSettings),
    });
    const { api } = await getApiModule();
    const result = await api.getSettings();
    expect(result).toEqual(mockSettings);
  });

  it("health returns status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: "ok", uptime: 123, version: "0.1.0" }),
    });
    const { api } = await getApiModule();
    const result = await api.health();
    expect(result.status).toBe("ok");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });
    const { api } = await getApiModule();
    await expect(api.getTask("nonexistent")).rejects.toThrow("Not found");
  });
});
