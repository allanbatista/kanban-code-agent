import type { Agent } from '../../domain/agent.js';
import type { AgentRunResult, AgentRunner, AgentRunConfig } from '../../application/pi-client.js';
import type { AgentDecision } from '../../domain/task.js';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------
// Test agent fixture
// ---------------------------------------------------------------------------

export const testAgent: Agent = {
  name: 'agent-tester',
  role: 'Voce e um agente de teste.',
  runtimeConfig: { model: 'fast', effort: 'off' },
  tools: ['read', 'grep'],
};

// ---------------------------------------------------------------------------
// Decision builders
// ---------------------------------------------------------------------------

export function completedDecision(text = 'Tarefa concluida com sucesso.'): string {
  return JSON.stringify({
    status: 'completed',
    messages: [{ type: 'text', text }],
  });
}

export function waitingDecision(
  waitGroups: Array<{ waitId: string; mode: 'WAIT_ALL' | 'ON_DEMAND'; taskIds: string[] }>,
  text = 'Aguardando subtasks.',
): string {
  return JSON.stringify({ status: 'waiting', messages: [{ type: 'text', text }], waitGroups });
}

export function retryDecision(instructions = 'Tente novamente com novo modelo', model?: string, effort?: string): string {
  const base: Record<string, unknown> = {
    status: 'retry',
    messages: [{ type: 'text', text: 'Precisa retry' }],
    instructions,
  };
  if (model) base.model = model;
  if (effort) base.effort = effort;
  return JSON.stringify(base);
}

// ---------------------------------------------------------------------------
// Runner builders
// ---------------------------------------------------------------------------

export function makeRunner(responses: string[]): AgentRunner {
  let index = 0;
  return {
    async run(): Promise<AgentRunResult> {
      const output = responses[index] ?? completedDecision();
      index++;
      return {
        output,
        stats: { tokens: { input: 100, output: 50, total: 150 }, cost: 0.001 },
      };
    },
  };
}

export function makeDecisionRunner(decisions: AgentDecision[]): AgentRunner {
  let index = 0;
  return {
    async run(): Promise<AgentRunResult> {
      const decision = decisions[index] ?? { status: 'completed', messages: [{ type: 'text', text: 'done' }] };
      index++;
      return {
        output: JSON.stringify(decision),
        stats: { tokens: { input: 100, output: 50, total: 150 }, cost: 0.001 },
      };
    },
  };
}

export function makeRoutedRunner(
  byTask: Record<string, string[]>,
  gates: Record<string, Promise<unknown>> = {},
): AgentRunner {
  const idx: Record<string, number> = {};
  return {
    async run(config: AgentRunConfig): Promise<AgentRunResult> {
      const taskId = basename(String(config.cwd));
      if (taskId in gates) await gates[taskId];
      const i = idx[taskId] ?? 0;
      idx[taskId] = i + 1;
      const output = (byTask[taskId] ?? [])[i] ?? completedDecision();
      return { output, stats: { tokens: { input: 10, output: 5, total: 15 }, cost: 0.001 } };
    },
  };
}

export function throwingRunner(error: Error): AgentRunner {
  return {
    async run(): Promise<AgentRunResult> {
      throw error;
    },
  };
}
