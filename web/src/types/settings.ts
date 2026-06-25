export type SettingsSection = 'appearance' | 'providers' | 'advanced';

export interface AppearanceSettings {
  fontSize: number;
  fontFamily: string;
  theme: string;
  density: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl?: string;
  apiKey?: string;
  models: string[];
}

export interface AdvancedSettings {
  runTimeoutMs: number;
  maxTaskDepth: number;
  maxSubtasks: number;
  maxRetries: number;
  maxTechnicalRetries: number;
  maxTokensBudget: number;
  maxCostBudget: number;
}
