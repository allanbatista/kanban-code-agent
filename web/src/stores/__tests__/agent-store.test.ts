import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock API
vi.mock("@/api/client", () => ({
  api: {
    getAgents: vi.fn(),
    updateAgent: vi.fn(),
  },
}));

// Mock adapter
vi.mock("@/api/adapter", () => ({
  apiAgentToAgent: (a: any) => ({
    id: a.name,
    name: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    icon: "Bot",
    color: "#94a3b8",
  }),
}));

import { api } from "@/api/client";

describe("agent-store (T04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchAgents loads agents from API", async () => {
    const mockAgents = [
      { name: "engineer", role: "Developer", runtimeConfig: {}, tools: [] },
      { name: "qa", role: "Tester", runtimeConfig: {}, tools: [] },
    ];
    (api.getAgents as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      agents: mockAgents,
      total: 2,
    });

    const { useAgentStore } = await import("@/stores/agent-store");
    useAgentStore.setState({ agents: [], loading: false, error: null });

    await useAgentStore.getState().fetchAgents();

    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(2);
    expect(state.agents[0].id).toBe("engineer");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("fetchAgents sets error on failure", async () => {
    (api.getAgents as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { useAgentStore } = await import("@/stores/agent-store");
    useAgentStore.setState({ agents: [], loading: false, error: null });

    await useAgentStore.getState().fetchAgents();

    const state = useAgentStore.getState();
    expect(state.error).toBe("Error: Network error");
    expect(state.loading).toBe(false);
  });

  it("updateAgent sends PATCH and re-fetches", async () => {
    (api.updateAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      name: "engineer",
      role: "Senior Dev",
      runtimeConfig: {},
      tools: [],
    });
    (api.getAgents as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      agents: [{ name: "engineer", role: "Senior Dev", runtimeConfig: {}, tools: [] }],
      total: 1,
    });

    const { useAgentStore } = await import("@/stores/agent-store");
    useAgentStore.setState({ agents: [], loading: false, error: null });

    await useAgentStore.getState().updateAgent("engineer", { role: "Senior Dev" });

    expect(api.updateAgent).toHaveBeenCalledWith("engineer", { role: "Senior Dev" });
    const state = useAgentStore.getState();
    expect(state.agents).toHaveLength(1);
  });
});
