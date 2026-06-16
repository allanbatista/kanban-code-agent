import type { Provider } from '@/types/provider';

export const MOCK_PROVIDERS: Provider[] = [
  { id: 'openrouter', name: 'OpenRouter', status: 'connected', defaultModel: 'deepseek-v4', apiKeyConfigured: true },
  { id: 'openai', name: 'OpenAI', status: 'not_configured', defaultModel: 'gpt-4o', apiKeyConfigured: false },
  { id: 'anthropic', name: 'Anthropic', status: 'not_configured', defaultModel: 'claude-4', apiKeyConfigured: false },
  { id: 'google', name: 'Google AI', status: 'not_configured', defaultModel: 'gemini-2.0', apiKeyConfigured: false },
];

export const EFFORT_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
];

export const MODEL_ALIASES = [
  { value: 'fast', label: 'Fast', description: 'Tarefas simples e baixo custo' },
  { value: 'balanced', label: 'Balanced', description: 'Uso geral equilibrado' },
  { value: 'deep', label: 'Deep', description: 'Tarefas complexas ou críticas' },
];

export const FONT_FAMILIES = ['Inter', 'JetBrains Mono', 'Fira Code', 'Source Sans Pro', 'IBM Plex Sans'];
export const THEMES = ['Dark', 'Light', 'System'];
export const DENSITIES = ['Compact', 'Comfortable', 'Spacious'];
