export type ContextStrategy = 'rehydrate' | 'compact' | 'reset';

/**
 * Choose context strategy based on task state.
 * - rehydrate: default, use indexed rehydration (scope-spec + progress + chat tail)
 * - compact: active session growing too large, summarize in-place
 * - reset: context anxiety, start fresh with handoff
 */
export function chooseContextStrategy(chatLength: number, maxMessages: number): ContextStrategy {
  const ratio = chatLength / maxMessages;
  if (ratio >= 1.0) return 'compact';
  if (ratio >= 0.8) return 'rehydrate';
  return 'rehydrate';
}

/**
 * Micro-cycle instruction injected into prompts (§6).
 * Guides the agent through observe→plan→act→verify with self-critique.
 */
export const MICRO_CYCLE_INSTRUCTION = `
CICLO DE TRABALHO:
1. OBSERVE: analise o estado atual (scope-spec, progresso, resultados anteriores)
2. PLANEJE: defina o proximo passo concreto e verificavel
3. AGA: execute o plano (use tools: read, write, bash, edit)
4. VERIFIQUE: confirme se o resultado atende ao scope-spec, auto-critique
5. RETORNE: JSON estruturado com status e mensagens
`.trim();
