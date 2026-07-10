import { create } from 'zustand';
import { api } from '@/api/client';
import { apiSettingsToAppearance, apiSettingsToAdvanced } from '@/api/adapter';
import type { AppearanceSettings, AdvancedSettings, ProviderConfig } from '@/types/settings';
import type { ApiProviderConfig } from '@/types/api';

type AgentKind = 'pi' | 'codex';

interface SettingsState {
  agentDefault: AgentKind;
  appearance: AppearanceSettings;
  advanced: AdvancedSettings;
  providers: ProviderConfig[];
  rawProviders: ApiProviderConfig[];
  // Keys digitadas pelo usuário, por provider.name. Enviadas só quando não vazias
  // (o backend preserva a key existente quando o campo vem em branco).
  providerKeyEdits: Record<string, string>;
  loading: boolean;
  error: string | null;

  fetchSettings: () => Promise<void>;
  updateAppearance: (data: Partial<AppearanceSettings>) => void;
  updateAdvanced: (data: Partial<AdvancedSettings>) => void;
  updateAgentDefault: (agent: AgentKind) => void;
  setProviderKey: (name: string, key: string) => void;
  saveSettings: () => Promise<void>;
}

function apiProviderToUI(p: ApiProviderConfig): ProviderConfig {
  return {
    id: p.name,
    name: p.provider,
    baseUrl: undefined,
    apiKey: p.apiKey ? 'configured' : undefined,
    models: [p.modelId],
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appearance: {
    fontSize: 14,
    fontFamily: 'Inter',
    theme: 'Dark',
    density: 'Comfortable',
  },
  advanced: {
    runTimeoutMs: 600000,
    maxTaskDepth: 4,
    maxSubtasks: 25,
    maxRetries: 2,
    maxTechnicalRetries: 2,
    maxTokensBudget: 0,
    maxCostBudget: 0,
  },
  agentDefault: 'pi',
  providers: [],
  rawProviders: [],
  providerKeyEdits: {},
  loading: false,
  error: null,

  fetchSettings: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await api.getSettings();
      set({
        agentDefault: settings.agent ?? 'pi',
        appearance: apiSettingsToAppearance(settings),
        advanced: apiSettingsToAdvanced(settings),
        providers: (settings.providers ?? []).map(apiProviderToUI),
        rawProviders: settings.providers ?? [],
        providerKeyEdits: {},
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  updateAppearance: (data) =>
    set((state) => ({
      appearance: { ...state.appearance, ...data },
    })),

  updateAdvanced: (data) =>
    set((state) => ({
      advanced: { ...state.advanced, ...data },
    })),

  updateAgentDefault: (agent) => set({ agentDefault: agent }),

  setProviderKey: (name, key) =>
    set((state) => ({
      providerKeyEdits: { ...state.providerKeyEdits, [name]: key },
    })),

  saveSettings: async () => {
    const state = get();
    try {
      await api.updateSettings({
        agent: state.agentDefault,
        appearance: {
          theme: state.appearance.theme.toLowerCase() === 'dark' ? 'dark' : state.appearance.theme.toLowerCase() === 'light' ? 'light' : 'system',
          language: 'pt-BR',
        },
        // apiKey só quando o usuário digitou uma; em branco o backend preserva.
        providers: state.rawProviders.map((p) => ({
          name: p.name,
          provider: p.provider,
          modelId: p.modelId,
          enabled: p.enabled,
          apiKey: state.providerKeyEdits[p.name] ?? '',
        })),
        advanced: {
          runTimeoutMs: state.advanced.runTimeoutMs,
          maxTaskDepth: state.advanced.maxTaskDepth,
          maxSubtasksPerTask: state.advanced.maxSubtasks,
          maxRetries: state.advanced.maxRetries,
          maxTechnicalRetries: state.advanced.maxTechnicalRetries,
        },
      });
      await get().fetchSettings();
    } catch (err) {
      set({ error: String(err) });
    }
  },
}));
