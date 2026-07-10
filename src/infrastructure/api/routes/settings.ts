import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';
import type { Settings, SettingsStore } from '../../persistence/settings-store.js';
import { CodexAuthManager, CodexBinaryMissingError, LoginBusyError } from '../../security/codex-auth.js';

// --- Zod Schemas ---

const themeEnum = z.enum(['light', 'dark', 'system']);
const agentEnum = z.enum(['pi', 'codex']);

const providerConfigSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
  enabled: z.boolean(),
});

const updateSettingsBody = z.object({
  agent: agentEnum.optional(),
  appearance: z.object({
    theme: themeEnum.optional(),
    language: z.string().min(1).max(10).optional(),
  }).optional(),
  providers: z.array(providerConfigSchema).optional(),
  advanced: z.object({
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
    agent: settings.agent,
    appearance: { ...settings.appearance },
    providers: settings.providers.map((p) => ({ ...p, apiKey: maskApiKey(p.apiKey) })),
    advanced: { ...settings.advanced },
  };
}

// --- Route Registration ---

const codexLoginBody = z.discriminatedUnion('method', [
  z.object({ method: z.literal('apiKey'), apiKey: z.string().min(1) }),
  z.object({ method: z.literal('deviceCode') }),
]);

// Mapeia erros de auth do Codex para status HTTP claros (nunca vaza a key).
function replyCodexError(reply: FastifyReply, err: unknown) {
  if (err instanceof CodexBinaryMissingError) {
    return reply.status(503).send({ error: 'Codex CLI não instalado (defina SWARM_CODEX_BIN).' });
  }
  if (err instanceof LoginBusyError) {
    return reply.status(409).send({ error: 'Já existe um login do Codex em andamento.' });
  }
  return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro no login do Codex.' });
}

export interface SettingsRouteDeps {
  settingsStore: SettingsStore;
  orquestrator: Orquestrator;
  /** Injecao para testes; default cria do dataDir do orquestrator. */
  codexAuth?: CodexAuthManager;
}

export function registerSettingsRoutes(fastify: FastifyInstance, deps: SettingsRouteDeps): void {
  const { settingsStore, orquestrator } = deps;
  const codexAuth = deps.codexAuth ?? new CodexAuthManager(orquestrator.sandbox.getBaseDir());

  // GET /api/settings — settings persistidos (keys mascaradas)
  fastify.get('/api/settings', async () => {
    return toSettingsResponse(settingsStore.load());
  });

  // PATCH /api/settings — valida, persiste e aplica hot (agent default + keys)
  fastify.patch('/api/settings', async (request, reply) => {
    const body = updateSettingsBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const settings = settingsStore.load();

    if (body.data.agent) settings.agent = body.data.agent;

    if (body.data.appearance) {
      settings.appearance = { ...settings.appearance, ...body.data.appearance };
    }

    if (body.data.providers) {
      settings.providers = body.data.providers.map((p) => {
        const existing = settings.providers.find((ep) => ep.name === p.name);
        // Preserva a key existente quando o cliente envia em branco (mascarada).
        return { ...p, apiKey: p.apiKey || existing?.apiKey || '' };
      });
    }

    if (body.data.advanced) {
      settings.advanced = { ...settings.advanced, ...body.data.advanced };
    }

    settingsStore.save(settings);
    // Aplica o agent default no runtime; keys são lidas do store pelo resolver.
    orquestrator.setDefaultAgent(settings.agent);

    return toSettingsResponse(settings);
  });

  // --- Auth compartilhada do Codex (CODEX_HOME em .swarm/auth/codex) ---

  // POST /api/settings/codex/login — {method:'apiKey', apiKey} | {method:'deviceCode'}
  fastify.post('/api/settings/codex/login', async (request, reply) => {
    const body = codexLoginBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    try {
      if (body.data.method === 'apiKey') {
        await codexAuth.loginWithApiKey(body.data.apiKey);
        return { ok: true };
      }
      // deviceCode: devolve URL+código para a UI exibir; status reporta a conclusão.
      return await codexAuth.startDeviceCodeLogin();
    } catch (err) {
      return replyCodexError(reply, err);
    }
  });

  // GET /api/settings/codex/status — nunca inclui tokens/keys.
  fastify.get('/api/settings/codex/status', async () => {
    return codexAuth.readStatus();
  });

  // POST /api/settings/codex/logout — remove o auth.json compartilhado.
  fastify.post('/api/settings/codex/logout', async () => {
    codexAuth.logout();
    return { ok: true };
  });
}
