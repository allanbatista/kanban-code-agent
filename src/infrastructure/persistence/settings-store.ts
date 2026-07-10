import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtomicWriter } from '../filesystem/atomic-writer.js';

// ---------------------------------------------------------------------------
// Settings persistidos em <dataDir>/.swarm/settings.json (0600).
// Fonte de runtime: agent default global + keys por provider (fallback envvar
// resolvido pelo pi-runner). Ver plan-agents-and-container-isolation.md §7.
// ---------------------------------------------------------------------------

export type AgentKind = 'pi' | 'codex';

export interface ProviderConfig {
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  enabled: boolean;
}

export interface Settings {
  agent: AgentKind;
  appearance: {
    theme: 'light' | 'dark' | 'system';
    language: string;
  };
  providers: ProviderConfig[];
  advanced: {
    runTimeoutMs: number;
    maxTaskDepth: number;
    maxSubtasksPerTask: number;
    maxRetries: number;
    maxTechnicalRetries: number;
    dataDir: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  agent: 'pi',
  appearance: {
    theme: 'system',
    language: 'pt-BR',
  },
  providers: [
    { name: 'fast', provider: 'deepseek', modelId: 'deepseek-v4-flash', apiKey: '', enabled: true },
    { name: 'balanced', provider: 'deepseek', modelId: 'deepseek-v4-flash', apiKey: '', enabled: true },
    { name: 'deep', provider: 'deepseek', modelId: 'deepseek-v4-pro', apiKey: '', enabled: true },
  ],
  advanced: {
    runTimeoutMs: 300000,
    maxTaskDepth: 5,
    maxSubtasksPerTask: 10,
    maxRetries: 3,
    maxTechnicalRetries: 2,
    dataDir: '~/.kca',
  },
};

/**
 * Store file-backed (JSON) para settings. Cada leitura relê o arquivo, então
 * instâncias distintas (rota HTTP vs. factory/resolver) enxergam o mesmo estado
 * sem cache stale — settings.json é a fonte da verdade.
 */
export class SettingsStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, '.swarm', 'settings.json');
  }

  /** Lê settings persistidos, mesclados com os defaults (unmasked). */
  load(): Settings {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_SETTINGS);
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<Settings>;
      return {
        agent: raw.agent ?? DEFAULT_SETTINGS.agent,
        appearance: { ...DEFAULT_SETTINGS.appearance, ...raw.appearance },
        providers: Array.isArray(raw.providers) ? raw.providers : structuredClone(DEFAULT_SETTINGS.providers),
        advanced: { ...DEFAULT_SETTINGS.advanced, ...raw.advanced },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** Persiste settings atomicamente com permissão 0600 (contém keys). */
  save(settings: Settings): void {
    AtomicWriter.writeJson(this.filePath, settings);
    chmodSync(this.filePath, 0o600);
  }

  /** Agent default global para o runtime. */
  getAgent(): AgentKind {
    return this.load().agent;
  }

  /**
   * Key do provider (ex.: 'deepseek') vinda dos settings. Retorna undefined se
   * não configurada — o pi-runner faz fallback para envvar. Precedência
   * settings→env fica no runner (settings vence quando não vazia).
   */
  getApiKey(provider: string): string | undefined {
    const match = this.load().providers.find((p) => p.provider === provider && p.apiKey);
    return match?.apiKey || undefined;
  }
}
