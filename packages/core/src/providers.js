const DEFAULT_MODELS = {
  openai: "gpt-5",
  openrouter: "",
  deepseek: "deepseek-chat",
  groq: "",
  together: "",
  fireworks: "",
  deepinfra: "",
  cerebras: "",
  mistral: "",
  gemini: "gemini-2.5-flash",
  xai: "grok-4",
  perplexity: "sonar",
  novita: "",
  openai_compatible: ""
};

export const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

export const DEFAULT_AI_SETTINGS = {
  defaultProvider: "openai",
  defaultModel: DEFAULT_MODELS.openai,
  defaultEffort: "medium",
  enabledProviders: [],
  providers: {}
};

export const PROVIDERS = [
  { id: "openai", label: "OpenAI", type: "openai-compatible", requiredEnv: ["OPENAI_API_KEY"], optionalEnv: ["OPENAI_ORG_ID", "OPENAI_PROJECT_ID"], apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", defaultModel: DEFAULT_MODELS.openai, contextSource: "models_or_unknown" },
  { id: "openrouter", label: "OpenRouter", type: "openai-compatible", requiredEnv: ["OPENROUTER_API_KEY"], optionalEnv: ["OPENROUTER_HTTP_REFERER", "OPENROUTER_APP_TITLE"], apiKeyEnv: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", defaultModel: DEFAULT_MODELS.openrouter, contextSource: "context_length" },
  { id: "deepseek", label: "DeepSeek", type: "openai-compatible", requiredEnv: ["DEEPSEEK_API_KEY"], optionalEnv: ["DEEPSEEK_DEFAULT_MODEL"], apiKeyEnv: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1", defaultModel: DEFAULT_MODELS.deepseek, contextSource: "models_or_unknown" },
  { id: "groq", label: "Groq", type: "openai-compatible", requiredEnv: ["GROQ_API_KEY"], optionalEnv: ["GROQ_DEFAULT_MODEL"], apiKeyEnv: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", defaultModel: DEFAULT_MODELS.groq, contextSource: "models_or_unknown" },
  { id: "together", label: "Together AI", type: "openai-compatible", requiredEnv: ["TOGETHER_API_KEY"], optionalEnv: ["TOGETHER_DEFAULT_MODEL"], apiKeyEnv: "TOGETHER_API_KEY", baseUrl: "https://api.together.xyz/v1", defaultModel: DEFAULT_MODELS.together, contextSource: "models_or_unknown" },
  { id: "fireworks", label: "Fireworks AI", type: "openai-compatible", requiredEnv: ["FIREWORKS_API_KEY"], optionalEnv: ["FIREWORKS_DEFAULT_MODEL"], apiKeyEnv: "FIREWORKS_API_KEY", baseUrl: "https://api.fireworks.ai/inference/v1", defaultModel: DEFAULT_MODELS.fireworks, contextSource: "models_or_unknown" },
  { id: "deepinfra", label: "DeepInfra", type: "openai-compatible", requiredEnv: ["DEEPINFRA_API_KEY"], optionalEnv: ["DEEPINFRA_DEFAULT_MODEL"], apiKeyEnv: "DEEPINFRA_API_KEY", baseUrl: "https://api.deepinfra.com/v1/openai", defaultModel: DEFAULT_MODELS.deepinfra, contextSource: "models_or_unknown" },
  { id: "cerebras", label: "Cerebras", type: "openai-compatible", requiredEnv: ["CEREBRAS_API_KEY"], optionalEnv: ["CEREBRAS_DEFAULT_MODEL"], apiKeyEnv: "CEREBRAS_API_KEY", baseUrl: "https://api.cerebras.ai/v1", defaultModel: DEFAULT_MODELS.cerebras, contextSource: "models_or_unknown" },
  { id: "mistral", label: "Mistral AI", type: "openai-compatible", requiredEnv: ["MISTRAL_API_KEY"], optionalEnv: ["MISTRAL_DEFAULT_MODEL"], apiKeyEnv: "MISTRAL_API_KEY", baseUrl: "https://api.mistral.ai/v1", defaultModel: DEFAULT_MODELS.mistral, contextSource: "models_or_unknown" },
  { id: "gemini", label: "Google Gemini", type: "openai-compatible", requiredEnv: ["GEMINI_API_KEY"], optionalEnv: ["GEMINI_DEFAULT_MODEL"], apiKeyEnv: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: DEFAULT_MODELS.gemini, contextSource: "models_or_unknown" },
  { id: "xai", label: "xAI", type: "openai-compatible", requiredEnv: ["XAI_API_KEY"], optionalEnv: ["XAI_DEFAULT_MODEL"], apiKeyEnv: "XAI_API_KEY", baseUrl: "https://api.x.ai/v1", defaultModel: DEFAULT_MODELS.xai, contextSource: "models_or_unknown" },
  { id: "perplexity", label: "Perplexity", type: "openai-compatible", requiredEnv: ["PERPLEXITY_API_KEY"], optionalEnv: ["PERPLEXITY_DEFAULT_MODEL"], apiKeyEnv: "PERPLEXITY_API_KEY", baseUrl: "https://api.perplexity.ai", defaultModel: DEFAULT_MODELS.perplexity, contextSource: "models_or_unknown" },
  { id: "novita", label: "Novita AI", type: "openai-compatible", requiredEnv: ["NOVITA_API_KEY"], optionalEnv: ["NOVITA_DEFAULT_MODEL"], apiKeyEnv: "NOVITA_API_KEY", baseUrl: "https://api.novita.ai/v3/openai", defaultModel: DEFAULT_MODELS.novita, contextSource: "models_or_unknown" },
  { id: "openai_compatible", label: "OpenAI Compatible", type: "openai-compatible", requiredEnv: ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"], optionalEnv: ["OPENAI_COMPATIBLE_DEFAULT_MODEL"], apiKeyEnv: "OPENAI_COMPATIBLE_API_KEY", baseUrlEnv: "OPENAI_COMPATIBLE_BASE_URL", baseUrl: null, defaultModel: DEFAULT_MODELS.openai_compatible, custom: true, contextSource: "models_or_unknown" }
];

function uniqById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function normalizeAiSettings(settings = {}) {
  const ai = settings.ai || settings || {};
  const enabledProviders = Array.isArray(ai.enabledProviders) ? ai.enabledProviders.filter((id) => id && id !== "pi") : [];
  return {
    ...DEFAULT_AI_SETTINGS,
    ...ai,
    defaultProvider: ai.defaultProvider && ai.defaultProvider !== "pi" ? ai.defaultProvider : DEFAULT_AI_SETTINGS.defaultProvider,
    defaultModel: ai.defaultModel === "default" ? "" : (ai.defaultModel ?? DEFAULT_AI_SETTINGS.defaultModel),
    enabledProviders,
    providers: ai.providers && typeof ai.providers === "object" ? ai.providers : {}
  };
}

export function providerById(providerId, settings = {}) {
  const ai = normalizeAiSettings(settings);
  const customProviders = Object.entries(ai.providers || {}).filter(([id]) => !PROVIDERS.some((provider) => provider.id === id)).map(([id, config]) => ({
    id,
    label: config.label || id,
    type: config.type || "openai-compatible",
    requiredEnv: config.requiredEnv || [config.apiKeyEnv, config.baseUrlEnv].filter(Boolean),
    optionalEnv: config.optionalEnv || [],
    apiKeyEnv: config.apiKeyEnv,
    baseUrlEnv: config.baseUrlEnv,
    baseUrl: config.baseUrl || null,
    defaultModel: config.defaultModel || "",
    custom: true,
    contextSource: config.contextSource || "models_or_unknown"
  }));
  const provider = uniqById([...PROVIDERS, ...customProviders]).find((item) => item.id === providerId);
  if (!provider) return null;
  const override = ai.providers?.[provider.id] || {};
  return { ...provider, ...override, id: provider.id, defaultModel: override.defaultModel ?? provider.defaultModel ?? "", defaultEffort: override.defaultEffort ?? provider.defaultEffort ?? ai.defaultEffort };
}

function providerBaseUrl(provider, env) {
  return provider?.baseUrl || (provider?.baseUrlEnv ? env[provider.baseUrlEnv] : null) || null;
}

export function discoverProviders(settings = {}, env = process.env) {
  if (!settings?.ai && settings !== process.env && Object.values(settings || {}).every((value) => typeof value === "string")) {
    env = settings;
    settings = {};
  }
  const ai = normalizeAiSettings(settings);
  const providers = uniqById([...PROVIDERS, ...Object.entries(ai.providers || {}).map(([id, config]) => ({ id, ...config, custom: true }))]);
  return {
    schema: "kanban-code-agent/provider-discovery@1",
    defaultProvider: ai.defaultProvider,
    defaultModel: ai.defaultModel,
    providers: providers.map((provider) => {
      const configuredProvider = providerById(provider.id, ai) || provider;
      const requiredEnv = configuredProvider.requiredEnv || [];
      const missingEnv = requiredEnv.filter((name) => !env[name]);
      const enabled = ai.enabledProviders.includes(configuredProvider.id);
      const baseUrl = providerBaseUrl(configuredProvider, env);
      return {
        ...configuredProvider,
        configured: missingEnv.length === 0 && Boolean(baseUrl),
        enabled,
        active: enabled && missingEnv.length === 0 && Boolean(baseUrl),
        missingEnv,
        requiredEnv,
        optionalEnv: configuredProvider.optionalEnv || [],
        baseUrl,
        modelsEndpoint: baseUrl ? `${baseUrl.replace(/\/$/, "")}/models` : null,
        defaultModel: configuredProvider.defaultModel || "",
        defaultEffort: configuredProvider.defaultEffort || ai.defaultEffort,
        contextSource: configuredProvider.contextSource || "models_or_unknown"
      };
    })
  };
}

function numeric(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function normalizeEfforts(...values) {
  const allowed = new Set(["minimal", "none", "low", "medium", "high", "xhigh"]);
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    return value.map((item) => String(item).trim()).filter((item) => allowed.has(item));
  }
  return undefined;
}

export function normalizeModel(raw) {
  const id = String(raw?.id || raw?.name || raw?.model || "").trim();
  if (!id) return null;
  const contextWindow = numeric(
    raw.contextWindow,
    raw.context_window,
    raw.contextLength,
    raw.context_length,
    raw.context_size,
    raw.max_context_length,
    raw.top_provider?.context_length,
    raw.limits?.context_window,
    raw.limits?.max_context_length
  );
  const maxOutputTokens = numeric(
    raw.maxOutputTokens,
    raw.max_output_tokens,
    raw.max_completion_tokens,
    raw.top_provider?.max_completion_tokens,
    raw.limits?.max_output_tokens,
    raw.limits?.max_completion_tokens
  );
  const supportedEfforts = normalizeEfforts(
    raw.supportedEfforts,
    raw.supported_efforts,
    raw.supportedReasoningEfforts,
    raw.supported_reasoning_efforts,
    raw.reasoningEfforts,
    raw.reasoning_efforts,
    raw.reasoning?.efforts,
    raw.top_provider?.supported_efforts
  );
  return {
    id,
    name: String(raw.name || raw.display_name || raw.label || id),
    contextWindow,
    maxOutputTokens,
    ...(supportedEfforts ? { supportedEfforts } : {})
  };
}

export async function listProviderModels(providerId, settings = {}, env = process.env, { fetchImpl = globalThis.fetch } = {}) {
  const discovered = discoverProviders(settings, env).providers.find((provider) => provider.id === providerId);
  if (!discovered) throw new Error(`Unknown provider: ${providerId}`);
  if (!discovered.configured) {
    return { schema: "kanban-code-agent/provider-models@1", providerId, models: [], error: `Provider ${providerId} inactive or missing env: ${discovered.missingEnv.join(", ") || "baseUrl"}` };
  }
  if (!fetchImpl) throw new Error("fetch unavailable");
  const headers = { "Content-Type": "application/json" };
  if (discovered.apiKeyEnv && env[discovered.apiKeyEnv]) headers.Authorization = `Bearer ${env[discovered.apiKeyEnv]}`;
  const response = await fetchImpl(discovered.modelsEndpoint, { headers });
  if (!response.ok) {
    return { schema: "kanban-code-agent/provider-models@1", providerId, models: [], error: `models request failed: ${response.status}` };
  }
  const data = await response.json();
  const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  const models = rawModels.map(normalizeModel).filter(Boolean);
  return { schema: "kanban-code-agent/provider-models@1", providerId, models };
}

export async function fetchOpenRouterModels(env = process.env, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!fetchImpl) throw new Error("fetch unavailable");
  const headers = { "Content-Type": "application/json" };
  if (env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;
  if (env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
  if (env.OPENROUTER_APP_TITLE) headers["X-Title"] = env.OPENROUTER_APP_TITLE;
  const controller = typeof AbortController === "function" && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_ENDPOINT, { headers, signal: controller?.signal });
    if (!response.ok) throw new Error(`openrouter models request failed: ${response.status}`);
    const data = await response.json();
    const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
    return {
      schema: "kanban-code-agent/provider-models-cache@1",
      providerId: "openrouter",
      source: OPENROUTER_MODELS_ENDPOINT,
      fetchedAt: new Date().toISOString(),
      models: rawModels.map(normalizeModel).filter(Boolean)
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function resolveProviderModel({ settings = {}, agentConfig = {}, role = {}, provider, model, effort } = {}) {
  const ai = normalizeAiSettings(settings);
  const agentModel = agentConfig?.model || {};
  const roleModel = role?.model || {};
  const rawProvider = provider || agentModel.provider || agentConfig.provider || roleModel.provider || "inherit";
  const inheritedProvider = !rawProvider || rawProvider === "inherit" || rawProvider === "pi";
  const providerId = inheritedProvider ? ai.defaultProvider : rawProvider;
  const rawModel = model ?? agentModel.name ?? roleModel.name ?? "";
  const inheritedModel = inheritedProvider || !rawModel || rawModel === "default";
  const providerConfig = providerById(providerId, ai);
  const modelName = inheritedModel ? (ai.defaultModel || providerConfig?.defaultModel || "") : rawModel;
  return {
    provider: providerId,
    model: modelName,
    effort: effort || agentModel.effort || roleModel.effort || providerConfig?.defaultEffort || ai.defaultEffort || "medium",
    inheritedProvider,
    inheritedModel,
    legacyPi: rawProvider === "pi"
  };
}
