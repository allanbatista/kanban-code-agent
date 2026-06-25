export type ContextStrategy = 'rehydrate' | 'compact' | 'reset';

/**
 * Choose the context strategy for the current state (§3.4 — state-dependent
 * routing). Kept deliberately simple (a threshold) and marked as scaffolding:
 * as models sustain longer contexts this may stop being load-bearing (§1.2).
 * - rehydrate: default — indexed rehydration (scope-spec + progress + chat tail)
 * - compact: the working chat overflows the tail budget → summarize the omitted
 *   prefix in-place rather than silently dropping it.
 *
 * `reset` (full handoff) is intentionally NOT auto-selected here; see DEFERRED.md.
 */
export function chooseContextStrategy(chatLength: number, maxMessages: number): ContextStrategy {
  return chatLength > maxMessages ? 'compact' : 'rehydrate';
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
