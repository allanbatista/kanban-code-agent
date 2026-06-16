import { create } from 'zustand';
import type { AppearanceSettings, AdvancedSettings } from '@/types/settings';

interface SettingsState {
  appearance: AppearanceSettings;
  advanced: AdvancedSettings;
  updateAppearance: (data: Partial<AppearanceSettings>) => void;
  updateAdvanced: (data: Partial<AdvancedSettings>) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  appearance: {
    fontSize: 14,
    fontFamily: 'Inter',
    theme: 'Dark',
    density: 'Comfortable',
  },
  advanced: {
    maxConcurrency: 3,
    runTimeoutMs: 600000,
    maxTaskDepth: 4,
    maxSubtasks: 25,
    maxRetries: 2,
    maxTechnicalRetries: 2,
    maxTokensBudget: 0,
    maxCostBudget: 0,
  },

  updateAppearance: (data) =>
    set((state) => ({
      appearance: { ...state.appearance, ...data },
    })),

  updateAdvanced: (data) =>
    set((state) => ({
      advanced: { ...state.advanced, ...data },
    })),
}));
