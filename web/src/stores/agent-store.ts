import { create } from "zustand";
import { api } from "@/api/client";
import { apiAgentToAgent } from "@/api/adapter";
import type { Agent } from "@/types/task";

interface AgentState {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  updateAgent: (
    name: string,
    data: { runtimeConfig?: { model?: string; effort?: string }; role?: string }
  ) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const response = await api.getAgents();
      const agents = response.agents.map(apiAgentToAgent);
      set({ agents, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  updateAgent: async (name, data) => {
    try {
      await api.updateAgent(name, data);
      // Re-fetch to sync state
      const response = await api.getAgents();
      const agents = response.agents.map(apiAgentToAgent);
      set({ agents });
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
