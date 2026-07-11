import { describe, expect, it, vi } from 'vitest';
import type { AgentClient } from '../../application/agent-client.js';
import { RoutingAgentClient } from '../../cli/orquestrator-factory.js';

// ---------------------------------------------------------------------------
// generateTitle deve SEMPRE rotear para o pi (chamada in-process barata), nunca
// gerar spawn do codex — mesmo quando o agent default global e codex.
// ---------------------------------------------------------------------------
describe('RoutingAgentClient.generateTitle', () => {
  it('usa o pi mesmo quando o codex e o agent default', async () => {
    const piTitle = vi.fn().mockResolvedValue('titulo do pi');
    const codexTitle = vi.fn().mockResolvedValue('titulo do codex');
    const makePi = vi.fn(() => ({ generateTitle: piTitle }) as unknown as AgentClient);
    const makeCodex = vi.fn(() => ({ generateTitle: codexTitle }) as unknown as AgentClient);

    const client = new RoutingAgentClient(makePi, makeCodex, () => 'codex');

    const title = await client.generateTitle('mensagem qualquer');

    expect(title).toBe('titulo do pi');
    expect(piTitle).toHaveBeenCalledOnce();
    // Codex nunca deve ser instanciado nem chamado para um titulo.
    expect(makeCodex).not.toHaveBeenCalled();
    expect(codexTitle).not.toHaveBeenCalled();
  });

  it('cai no truncamento quando o pi lanca (ex.: sem key deepseek)', async () => {
    const piTitle = vi.fn().mockRejectedValue(new Error('no deepseek key'));
    const makePi = vi.fn(() => ({ generateTitle: piTitle }) as unknown as AgentClient);
    const makeCodex = vi.fn(() => ({}) as unknown as AgentClient);

    const client = new RoutingAgentClient(makePi, makeCodex, () => 'codex');

    const message = 'a'.repeat(120);
    const title = await client.generateTitle(message);

    // Heuristica: primeira linha, no maximo 60 chars.
    expect(title).toBe('a'.repeat(60));
    expect(makeCodex).not.toHaveBeenCalled();
  });
});
