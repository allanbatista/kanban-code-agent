import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelConfig {
  provider: string;
  modelId: string;
}

export interface SwarmConfig {
  port: number;
  dataDir: string;
  logLevel: string;
  runTimeoutMs: number;
  maxConcurrentRuns: number;
  isolation: 'inproc' | 'docker';
  models: {
    fast: ModelConfig;
    balanced: ModelConfig;
    deep: ModelConfig;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: SwarmConfig = {
  port: 35000,
  // Data root: ~/.kca — all swarm persistence lives under ~/.kca/.swarm/
  // Override via SWARM_DATA_DIR envvar or data_dir in swarm.yml.
  // Structure: .swarm/{events,tasks,state.snapshot.json}
  dataDir: resolve(homedir(), '.kca'),
  logLevel: 'info',
  runTimeoutMs: 300_000,
  maxConcurrentRuns: 4,
  isolation: 'inproc',
  models: {
    // Pi SDK native providers (provider name + bare model id). The deepseek
    // provider auto-uses DEEPSEEK_API_KEY. Override via swarm.yml / env.
    fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
    balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
    deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro' },
  },
};

// ---------------------------------------------------------------------------
// Config file

function loadConfigFile(configPath?: string): Partial<SwarmConfig> {
  const paths = configPath
    ? [resolve(configPath)]
    : [resolve('swarm.yml'), resolve('swarm.yaml'), resolve('swarm.json')];

  for (const path of paths) {
    if (!existsSync(path)) continue;

    try {
      const content = readFileSync(path, 'utf-8');

      if (path.endsWith('.json')) {
        const parsed = JSON.parse(content);
        return normalizeFileConfig(parsed);
      }

      // Simple YAML subset: only flat keys and nested models block
      return parseSimpleYamlConfig(content);
    } catch {
      // Ignore parse errors, fall through to next file
    }
  }

  return {};
}

interface FileConfigRaw {
  port?: number;
  dataDir?: string;
  'data_dir'?: string;
  logLevel?: string;
  'log_level'?: string;
  runTimeoutMs?: number;
  'run_timeout_ms'?: number;
  maxConcurrentRuns?: number;
  'max_concurrent_runs'?: number;
  isolation?: 'inproc' | 'docker';
  models?: {
    fast?: { provider?: string; modelId?: string; model_id?: string };
    balanced?: { provider?: string; modelId?: string; model_id?: string };
    deep?: { provider?: string; modelId?: string; model_id?: string };
  };
}

function normalizeFileConfig(raw: FileConfigRaw): Partial<SwarmConfig> {
  const result: Partial<SwarmConfig> = {};

  if (typeof raw.port === 'number') result.port = raw.port;
  if (typeof raw.dataDir === 'string') result.dataDir = raw.dataDir;
  else if (typeof raw['data_dir'] === 'string') result.dataDir = raw['data_dir'];
  if (typeof raw.logLevel === 'string') result.logLevel = raw.logLevel;
  else if (typeof raw['log_level'] === 'string') result.logLevel = raw['log_level'];
  if (typeof raw.runTimeoutMs === 'number') result.runTimeoutMs = raw.runTimeoutMs;
  else if (typeof raw['run_timeout_ms'] === 'number') result.runTimeoutMs = raw['run_timeout_ms'];
  if (typeof raw.maxConcurrentRuns === 'number') result.maxConcurrentRuns = raw.maxConcurrentRuns;
  else if (typeof raw['max_concurrent_runs'] === 'number') result.maxConcurrentRuns = raw['max_concurrent_runs'];
  if (raw.isolation === 'inproc' || raw.isolation === 'docker') result.isolation = raw.isolation;

  if (raw.models) {
    result.models = {
      fast: normalizeModelConfig(raw.models.fast, DEFAULTS.models.fast),
      balanced: normalizeModelConfig(raw.models.balanced, DEFAULTS.models.balanced),
      deep: normalizeModelConfig(raw.models.deep, DEFAULTS.models.deep),
    };
  }

  return result;
}

function normalizeModelConfig(
  raw: Record<string, unknown> | undefined,
  fallback: ModelConfig,
): ModelConfig {
  if (!raw || typeof raw !== 'object') return fallback;
  const cfg = raw as Record<string, unknown>;
  return {
    provider: typeof cfg.provider === 'string' ? cfg.provider : fallback.provider,
    modelId: typeof cfg.modelId === 'string' ? cfg.modelId : typeof cfg['model_id'] === 'string' ? cfg['model_id'] : fallback.modelId,
  };
}

// Minimal YAML parser for our flat config format
function parseSimpleYamlConfig(content: string): Partial<SwarmConfig> {
  const lines = content.split('\n');
  const raw: Record<string, unknown> = {};
  const models: Record<string, Record<string, string>> = {};
  let currentModel: string | null = null;
  let inModels = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'models:') {
      inModels = true;
      continue;
    }

    if (inModels) {
      const modelMatch = trimmed.match(/^(\w+):$/);
      if (modelMatch) {
        currentModel = modelMatch[1];
        models[currentModel] = {};
        continue;
      }

      const propMatch = trimmed.match(/^(\w+):\s*(.+)$/);
      if (propMatch && currentModel) {
        const key = propMatch[1].replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        const value = propMatch[2].trim().replace(/^['"]|['"]$/g, '');
        models[currentModel][key] = value;
        continue;
      }

      // If indentation goes back, exit models block
      if (!trimmed.startsWith(' ') && !trimmed.startsWith('\t')) {
        inModels = false;
        currentModel = null;
      }
      continue;
    }

    const match = trimmed.match(/^(\w[\w_]*):\s*(.+)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');

      const numVal = Number(value);
      if (key === 'port' || key === 'run_timeout_ms' || key === 'runTimeoutMs' || key === 'max_concurrent_runs' || key === 'maxConcurrentRuns') {
        raw[key] = Number.isFinite(numVal) ? numVal : value;
      } else {
        raw[key] = value;
      }
    }
  }

  const result = normalizeFileConfig(raw as FileConfigRaw);

  if (Object.keys(models).length > 0) {
    result.models = {
      fast: normalizeModelConfig(models.fast as unknown as Record<string, unknown>, DEFAULTS.models.fast),
      balanced: normalizeModelConfig(models.balanced as unknown as Record<string, unknown>, DEFAULTS.models.balanced),
      deep: normalizeModelConfig(models.deep as unknown as Record<string, unknown>, DEFAULTS.models.deep),
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

function readEnvOverrides(): Partial<SwarmConfig> {
  const overrides: Partial<SwarmConfig> = {};

  const port = readPositiveIntEnv('SWARM_PORT');
  if (port !== undefined) overrides.port = port;

  const dataDir = process.env['SWARM_DATA_DIR'];
  if (typeof dataDir === 'string' && dataDir.trim()) overrides.dataDir = dataDir.trim();

  const logLevel = process.env['SWARM_LOG_LEVEL'];
  if (typeof logLevel === 'string' && logLevel.trim()) overrides.logLevel = logLevel.trim();

  const runTimeoutMs = readPositiveIntEnv('SWARM_RUN_TIMEOUT_MS');
  if (runTimeoutMs !== undefined) overrides.runTimeoutMs = runTimeoutMs;

  const maxConcurrentRuns = readPositiveIntEnv('SWARM_MAX_CONCURRENT_RUNS');
  if (maxConcurrentRuns !== undefined) overrides.maxConcurrentRuns = maxConcurrentRuns;

  const isolation = process.env['SWARM_ISOLATION'];
  if (isolation === 'inproc' || isolation === 'docker') overrides.isolation = isolation;

  return overrides;
}

function readPositiveIntEnv(key: string): number | undefined {
  const value = process.env[key];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function mergeConfig(fileConfig: Partial<SwarmConfig>, envOverrides: Partial<SwarmConfig>): SwarmConfig {
  return {
    port: envOverrides.port ?? fileConfig.port ?? DEFAULTS.port,
    dataDir: envOverrides.dataDir ?? fileConfig.dataDir ?? DEFAULTS.dataDir,
    logLevel: envOverrides.logLevel ?? fileConfig.logLevel ?? DEFAULTS.logLevel,
    runTimeoutMs: envOverrides.runTimeoutMs ?? fileConfig.runTimeoutMs ?? DEFAULTS.runTimeoutMs,
    maxConcurrentRuns: envOverrides.maxConcurrentRuns ?? fileConfig.maxConcurrentRuns ?? DEFAULTS.maxConcurrentRuns,
    isolation: envOverrides.isolation ?? fileConfig.isolation ?? DEFAULTS.isolation,
    models: {
      fast: {
        provider: fileConfig.models?.fast?.provider ?? DEFAULTS.models.fast.provider,
        modelId: fileConfig.models?.fast?.modelId ?? DEFAULTS.models.fast.modelId,
      },
      balanced: {
        provider: fileConfig.models?.balanced?.provider ?? DEFAULTS.models.balanced.provider,
        modelId: fileConfig.models?.balanced?.modelId ?? DEFAULTS.models.balanced.modelId,
      },
      deep: {
        provider: fileConfig.models?.deep?.provider ?? DEFAULTS.models.deep.provider,
        modelId: fileConfig.models?.deep?.modelId ?? DEFAULTS.models.deep.modelId,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function loadConfig(configPath?: string): SwarmConfig {
  const fileConfig = loadConfigFile(configPath);
  const envOverrides = readEnvOverrides();
  const config = mergeConfig(fileConfig, envOverrides);
  validateConfig(config);
  return config;
}

function validateConfig(config: SwarmConfig): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`SWARM_PORT deve ser inteiro entre 1-65535, recebeu: ${config.port}`);
  }
  if (typeof config.dataDir !== 'string' || !config.dataDir.trim()) {
    throw new Error('SWARM_DATA_DIR nao pode ser vazio');
  }
  if (!Number.isInteger(config.runTimeoutMs) || config.runTimeoutMs < 1000) {
    throw new Error(`SWARM_RUN_TIMEOUT_MS deve ser >= 1000, recebeu: ${config.runTimeoutMs}`);
  }
  if (!Number.isInteger(config.maxConcurrentRuns) || config.maxConcurrentRuns < 1) {
    throw new Error(`SWARM_MAX_CONCURRENT_RUNS deve ser >= 1, recebeu: ${config.maxConcurrentRuns}`);
  }
  if (config.isolation !== 'inproc' && config.isolation !== 'docker') {
    throw new Error(`SWARM_ISOLATION deve ser inproc ou docker, recebeu: ${config.isolation}`);
  }

  for (const alias of ['fast', 'balanced', 'deep'] as const) {
    const model = config.models[alias];
    if (!model.provider || !model.modelId) {
      throw new Error(`Modelo '${alias}' incompleto: provider=${model.provider}, modelId=${model.modelId}`);
    }
  }
}
