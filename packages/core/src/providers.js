export const PROVIDERS = [
  { id: "pi", type: "local", requiredEnv: [], optionalEnv: [], baseUrl: null },
  { id: "openai", type: "native", requiredEnv: ["OPENAI_API_KEY"], optionalEnv: ["OPENAI_ORG_ID", "OPENAI_PROJECT_ID"], baseUrl: "https://api.openai.com/v1" },
  { id: "openrouter", type: "openai-compatible", requiredEnv: ["OPENROUTER_API_KEY"], optionalEnv: ["OPENROUTER_HTTP_REFERER", "OPENROUTER_APP_TITLE"], baseUrl: "https://openrouter.ai/api/v1" },
  { id: "openai_compatible", type: "openai-compatible", requiredEnv: ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"], optionalEnv: ["OPENAI_COMPATIBLE_DEFAULT_MODEL"], baseUrl: null },
  { id: "groq", type: "openai-compatible", requiredEnv: ["GROQ_API_KEY"], optionalEnv: ["GROQ_DEFAULT_MODEL"], baseUrl: "https://api.groq.com/openai/v1" },
  { id: "together", type: "openai-compatible", requiredEnv: ["TOGETHER_API_KEY"], optionalEnv: ["TOGETHER_DEFAULT_MODEL"], baseUrl: "https://api.together.xyz/v1" },
  { id: "fireworks", type: "openai-compatible", requiredEnv: ["FIREWORKS_API_KEY"], optionalEnv: ["FIREWORKS_DEFAULT_MODEL"], baseUrl: "https://api.fireworks.ai/inference/v1" },
  { id: "deepinfra", type: "openai-compatible", requiredEnv: ["DEEPINFRA_API_KEY"], optionalEnv: ["DEEPINFRA_DEFAULT_MODEL"], baseUrl: "https://api.deepinfra.com/v1/openai" },
  { id: "cerebras", type: "openai-compatible", requiredEnv: ["CEREBRAS_API_KEY"], optionalEnv: ["CEREBRAS_DEFAULT_MODEL"], baseUrl: "https://api.cerebras.ai/v1" }
];

export function discoverProviders(env = process.env) {
  return {
    schema: "kanban-code-agent/provider-discovery@1",
    providers: PROVIDERS.map((provider) => {
      const missingEnv = provider.requiredEnv.filter((name) => !env[name]);
      return { ...provider, configured: missingEnv.length === 0, missingEnv };
    })
  };
}

export function providerById(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) || null;
}
