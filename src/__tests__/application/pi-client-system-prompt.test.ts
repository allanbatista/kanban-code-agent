import { describe, expect, it } from 'vitest';
import { PiAgentClient, type AgentRunner } from '../../application/pi-client.js';
import type { Orquestrator } from '../../application/orquestrator.js';
import type { Agent } from '../../domain/agent.js';
import { Task } from '../../domain/task.js';

const runner: AgentRunner = {
  async run() {
    throw new Error('runner não deve ser chamado');
  },
};

const client = new PiAgentClient(
  runner,
  '',
  ['read'],
  { fast: { provider: 'test', modelId: 'test' } },
  10,
);

const orquestrator = {
  resolveRuntimeConfig: () => ({ model: 'fast', effort: 'off' }),
  toMetadata: () => ({ canCreateSubtasks: false }),
  getTaskWorkspaceDir: () => '/tmp/task_1',
  isOrchestrator: () => false,
  buildTaskMetadataBlock: () => 'metadata',
  buildAgentTools: () => [],
} as unknown as Orquestrator;

const task = new Task({ taskId: 'task_1', title: 'Teste', assignedTo: 'Engineer', depth: 0 });

function buildSystemPrompt(systemPrompt?: string, mustNot?: string[]): string {
  const agent: Agent = {
    name: 'Engineer',
    role: 'papel curto',
    systemPrompt,
    runtimeConfig: { model: 'fast', effort: 'off' },
    tools: ['read'],
    mustNot,
  };
  return client.buildRunConfig(agent, task, orquestrator, []).systemPrompt;
}

describe('PiAgentClient system prompt', () => {
  it('prefers the specialized prompt and falls back to role when it is blank', () => {
    expect(buildSystemPrompt('  prompt especializado  ')).toMatch(/^prompt especializado\n/);
    expect(buildSystemPrompt('   ')).toMatch(/^papel curto\n/);
    expect(buildSystemPrompt()).toMatch(/^papel curto\n/);
  });

  it('preserves role guardrails with a specialized prompt', () => {
    const prompt = buildSystemPrompt('prompt especializado', ['omitir erros']);
    expect(prompt).toContain('VOCE NAO DEVE (guardrails do papel):');
    expect(prompt).toContain('- omitir erros');
  });
});
