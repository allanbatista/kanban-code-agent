import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ModelAlias, EffortLevel } from '../../../domain/types.js';
import { MODEL_ALIAS, EFFORT_LEVEL } from '../../../domain/types.js';

// --- Settings Store ---

interface ProviderConfig {
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  enabled: boolean;
}

interface Settings {
  appearance: {
    theme: 'light' | 'dark' | 'system';
    language: string;
  };
  providers: ProviderConfig[];
  advanced: {
    maxConcurrency: number;
    runTimeoutMs: number;
    maxTaskDepth: number;
    maxSubtasksPerTask: number;
    maxRetries: number;
    maxTechnicalRetries: number;
    dataDir: string;
  };
}

const defaultSettings: Settings = {
  appearance: {
    theme: 'system',
    language: 'pt-BR',
  },
  providers: [
    {
      name: 'fast',
      provider: 'openrouter',
      modelId: 'openai/gpt-5.4-nano',
      apiKey: '',
      enabled: true,
    },
    {
      name: 'balanced',
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-flash',
      apiKey: '',
      enabled: true,
    },
    {
      name: 'deep',
      provider: 'openrouter',
      modelId: 'deepseek/deepseek-v4-pro',
      apiKey: '',
      enabled: true,
    },
  ],
  advanced: {
    maxConcurrency: 3,
    runTimeoutMs: 300000,
    maxTaskDepth: 5,
    maxSubtasksPerTask: 10,
    maxRetries: 3,
    maxTechnicalRetries: 2,
    dataDir: '.swarm',
  },
};

const currentSettings: Settings = JSON.parse(JSON.stringify(defaultSettings));

// --- Zod Schemas ---

const themeEnum = z.enum(['light', 'dark', 'system']);

const providerConfigSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  enabled: z.boolean(),
});

const updateSettingsBody = z.object({
  appearance: z.object({
    theme: themeEnum.optional(),
    language: z.string().min(1).max(10).optional(),
  }).optional(),
  providers: z.array(providerConfigSchema).optional(),
  advanced: z.object({
    maxConcurrency: z.number().int().min(1).max(50).optional(),
    runTimeoutMs: z.number().int().min(1000).optional(),
    maxTaskDepth: z.number().int().min(1).max(20).optional(),
    maxSubtasksPerTask: z.number().int().min(1).max(100).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    maxTechnicalRetries: z.number().int().min(0).max(10).optional(),
    dataDir: z.string().min(1).optional(),
  }).optional(),
});

// --- Helpers ---

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4);
}

function toSettingsResponse(settings: Settings) {
  return {
    appearance: { ...settings.appearance },
    providers: settings.providers.map((p) => ({
      ...p,
      apiKey: maskApiKey(p.apiKey),
    })),
    advanced: { ...settings.advanced },
  };
}

// --- Route Registration ---

export function registerSettingsRoutes(fastify: FastifyInstance): void {
  // GET /api/settings — get all settings
  fastify.get('/api/settings', async () => {
    return toSettingsResponse(currentSettings);
  });

  // PATCH /api/settings — update settings
  fastify.patch('/api/settings', async (request, reply) => {
    const body = updateSettingsBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    if (body.data.appearance) {
      currentSettings.appearance = {
        ...currentSettings.appearance,
        ...body.data.appearance,
      };
    }

    if (body.data.providers) {
      currentSettings.providers = body.data.providers.map((p) => {
        const existing = currentSettings.providers.find((ep) => ep.name === p.name);
        return {
          ...p,
          apiKey: p.apiKey || existing?.apiKey || '',
        };
      });
    }

    if (body.data.advanced) {
      currentSettings.advanced = {
        ...currentSettings.advanced,
        ...body.data.advanced,
      };
    }

    return toSettingsResponse(currentSettings);
  });
}
