/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AgentRunConfig,
  AgentRunResult,
  AgentRunner,
} from '../application/pi-client.js';
import { RunCancelledError } from '../application/pi-client.js';

/**
 * Real implementation of AgentRunner backed by Pi SDK.
 *
 * Dynamically imports the Pi SDK at runtime. If the package is not installed,
 * a descriptive error is thrown pointing the user to install it.
 *
 * Uses any-typed references to Pi SDK since it is an optional runtime dependency
 * not included in type checking.
 */
/**
 * Convert a plain JSON-schema object (Pi-agnostic, from the application layer)
 * into a TypeBox schema. Pi SDK tools require TypeBox schemas — passing a plain
 * object yields an empty parameter schema to the model, which then refuses to
 * call the tool. Supports the shallow shapes used by our orchestration tools.
 */
function jsonSchemaToTypeBox(schema: any, Type: any): any {
  if (!schema || typeof schema !== 'object') return Type.Any();
  const opts: Record<string, unknown> = {};
  if (typeof schema.description === 'string') opts.description = schema.description;

  if (Array.isArray(schema.enum)) {
    return Type.Union(schema.enum.map((value: unknown) => Type.Literal(value as string)), opts);
  }
  switch (schema.type) {
    case 'object': {
      const props = schema.properties ?? {};
      const required: string[] = Array.isArray(schema.required) ? schema.required : [];
      const shape: Record<string, any> = {};
      for (const [key, value] of Object.entries(props)) {
        const converted = jsonSchemaToTypeBox(value, Type);
        shape[key] = required.includes(key) ? converted : Type.Optional(converted);
      }
      const objectOpts: Record<string, unknown> = { ...opts };
      if (schema.additionalProperties === false) objectOpts.additionalProperties = false;
      return Type.Object(shape, objectOpts);
    }
    case 'array':
      return Type.Array(jsonSchemaToTypeBox(schema.items, Type), opts);
    case 'number':
    case 'integer':
      return Type.Number(opts);
    case 'boolean':
      return Type.Boolean(opts);
    case 'string':
    default:
      return Type.String(opts);
  }
}

export class PiSdkAgentRunner implements AgentRunner {
  private registry?: any;
  private settings?: any;
  private typeBox?: any;

  // Resolve a key do provider (ex.: 'deepseek') a partir dos settings; injetado
  // pela factory. Sem resolver (ou sem key nos settings), cai no envvar.
  constructor(private readonly apiKeyResolver?: (provider: string) => string | undefined) {}

  // Loads TypeBox from the Pi SDK's own dependency tree (it is not a direct dep
  // here). The SDK is ESM-only, so resolve its module URL and walk up to find
  // the sibling `typebox` package that pnpm installed alongside it.
  private async importTypeBox(): Promise<any> {
    if (this.typeBox) return this.typeBox;
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const { existsSync } = await import('node:fs');
    const piUrl = (import.meta as any).resolve('@earendil-works/pi-coding-agent') as string;
    let dir = dirname(fileURLToPath(piUrl));
    let found: string | undefined;
    while (dir !== dirname(dir)) {
      for (const candidate of [
        join(dir, 'typebox', 'build', 'index.mjs'),
        join(dir, 'node_modules', 'typebox', 'build', 'index.mjs'),
      ]) {
        if (existsSync(candidate)) {
          found = candidate;
          break;
        }
      }
      if (found) break;
      dir = dirname(dir);
    }
    if (!found) throw new Error('typebox nao encontrado no dependency tree do Pi SDK');
    this.typeBox = await import(found);
    return this.typeBox;
  }

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const piSdk: any = await this.importPiSdk();
    const modelConfig = config.model as { provider: string; modelId: string };

    if (!this.registry) {
      const auth = piSdk.AuthStorage.inMemory();
      this.registry = piSdk.ModelRegistry.inMemory(auth);
      this.settings = piSdk.SettingsManager.inMemory({});
      // Key do provider: settings vence quando não vazia, senão fallback envvar.
      const provider = modelConfig.provider;
      const envKey = provider.toUpperCase() + '_API_KEY';
      const apiKey = this.apiKeyResolver?.(provider) ?? process.env[envKey];
      if (apiKey) {
        auth.setRuntimeApiKey(provider, apiKey);
      }
      await this.registry.refresh();
    }

    const model = this.registry.find(modelConfig.provider, modelConfig.modelId);
    if (!model) {
      throw new Error(
        `Modelo ${modelConfig.provider}/${modelConfig.modelId} nao encontrado no Pi SDK`,
      );
    }

    const pi: any = piSdk;
    const sessionManager: any = config.sessionManager ?? pi.SessionManager.inMemory();
    // Orchestration tools (create_subtask, create_artifact) as Pi ToolDefinitions.
    const customTools = config.customTools ?? [];
    const Type = customTools.length > 0 ? (await this.importTypeBox()).Type : undefined;
    const piTools = customTools.map((tool) =>
      pi.defineTool({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: jsonSchemaToTypeBox(tool.parameters, Type),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const text = await tool.execute(params ?? {});
          return { content: [{ type: 'text', text }], details: text };
        },
      }),
    );
    const resourceLoader: any =
      config.resourceLoader ??
      new pi.DefaultResourceLoader({
        cwd: config.cwd,
        agentDir: pi.getAgentDir(),
        settingsManager: this.settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });

    let session: any;
    try {
      const sessionResult = await pi.createAgentSession({
        sessionManager,
        model,
        tools: config.tools,
        customTools: piTools,
        systemPrompt: config.systemPrompt,
        cwd: config.cwd,
        resourceLoader,
        thinkingLevel: config.thinkingLevel,
      });
      session = sessionResult.session;
    } catch (err: any) {
      throw new Error(`createAgentSession falhou: ${err?.message ?? err} (stack: ${err?.stack ?? 'N/A'})`);
    }

    if (!session) {
      throw new Error('createAgentSession retornou session indefinido');
    }

    const signal = config.signal;
    if (signal?.aborted) {
      if (session && typeof session.dispose === 'function') session.dispose();
      throw new RunCancelledError();
    }
    const onAbort = () => {
      if (session && typeof session.abort === 'function') void session.abort();
    };
    signal?.addEventListener('abort', onAbort);

    try {
      const statsBefore: any = session.getSessionStats();
      await session.prompt(config.prompt);
      if (signal?.aborted) throw new RunCancelledError();
      const statsAfter: any = session.getSessionStats();
      const output: string = typeof session.getLastAssistantText === 'function'
        ? (session.getLastAssistantText() ?? '')
        : '';

      // Pi SessionStats.tokens = { input, output, cacheRead, cacheWrite, total }.
      // `total` already bundles cache, so we surface cache separately to keep the
      // headline (input+output) honest: input + output + cache = total.
      const cacheBefore = (statsBefore?.tokens?.cacheRead ?? 0) + (statsBefore?.tokens?.cacheWrite ?? 0);
      const cacheAfter = (statsAfter?.tokens?.cacheRead ?? 0) + (statsAfter?.tokens?.cacheWrite ?? 0);
      return {
        output,
        stats: {
          tokens: {
            input: (statsAfter?.tokens?.input ?? 0) - (statsBefore?.tokens?.input ?? 0),
            output: (statsAfter?.tokens?.output ?? 0) - (statsBefore?.tokens?.output ?? 0),
            cache: cacheAfter - cacheBefore,
            total: (statsAfter?.tokens?.total ?? 0) - (statsBefore?.tokens?.total ?? 0),
          },
          cost: (statsAfter?.cost ?? 0) - (statsBefore?.cost ?? 0),
        },
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (session && typeof session.dispose === 'function') {
        session.dispose();
      }
    }
  }

  private async importPiSdk(): Promise<any> {
    try {
      return await import('@earendil-works/pi-coding-agent');
    } catch {
      throw new Error(
        'Pi SDK nao encontrado. Instale com: npm install @earendil-works/pi-coding-agent',
      );
    }
  }
}
