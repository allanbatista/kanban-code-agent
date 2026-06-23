/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  AgentRunConfig,
  AgentRunResult,
  AgentRunner,
} from '../application/pi-client.js';

/**
 * Real implementation of AgentRunner backed by Pi SDK.
 *
 * Dynamically imports the Pi SDK at runtime. If the package is not installed,
 * a descriptive error is thrown pointing the user to install it.
 *
 * Uses any-typed references to Pi SDK since it is an optional runtime dependency
 * not included in type checking.
 */
export class PiSdkAgentRunner implements AgentRunner {
  private registry?: any;
  private settings?: any;

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const piSdk: any = await this.importPiSdk();
    const modelConfig = config.model as { provider: string; modelId: string };

    if (!this.registry) {
      const auth = piSdk.AuthStorage.inMemory();
      this.registry = piSdk.ModelRegistry.inMemory(auth);
      this.settings = piSdk.SettingsManager.inMemory({});
      // Set API key for provider from env
      const provider = modelConfig.provider;
      const envKey = provider.toUpperCase() + '_API_KEY';
      if (process.env[envKey]) {
        auth.setRuntimeApiKey(provider, process.env[envKey]);
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

    try {
      const statsBefore: any = session.getSessionStats();
      await session.prompt(config.prompt);
      const statsAfter: any = session.getSessionStats();
      const output: string = typeof session.getLastAssistantText === 'function'
        ? (session.getLastAssistantText() ?? '')
        : '';

      return {
        output,
        stats: {
          tokens: {
            input: (statsAfter?.tokens?.input ?? 0) - (statsBefore?.tokens?.input ?? 0),
            output: (statsAfter?.tokens?.output ?? 0) - (statsBefore?.tokens?.output ?? 0),
            total: (statsAfter?.tokens?.total ?? 0) - (statsBefore?.tokens?.total ?? 0),
          },
          cost: (statsAfter?.cost ?? 0) - (statsBefore?.cost ?? 0),
        },
      };
    } finally {
      if (session && typeof session.dispose === 'function') {
        session.dispose();
      }
    }
  }

  private async importPiSdk(): Promise<any> {
    try {
      // @ts-expect-error - optional runtime dependency, not installed for typecheck
      return await import('@earendil-works/pi-coding-agent');
    } catch {
      throw new Error(
        'Pi SDK nao encontrado. Instale com: npm install @earendil-works/pi-coding-agent',
      );
    }
  }
}
