import { describe, it, expect } from 'vitest';
import { AGENTS, getAgentDefinition, getAgentNames } from '../../infrastructure/agents/index.js';

describe('Agent definitions', () => {
  it('exports all required agents', () => {
    const names = AGENTS.map((a) => a.name);
    expect(names).toContain('Manager');
    expect(names).toContain('Produto');
    expect(names).toContain('Generic');
    expect(names).toContain('Engineer');
  });

  it('includes Architecture agent with role, skills, guardrails', () => {
    const arch = AGENTS.find((a) => a.name === 'Architecture');
    expect(arch).toBeDefined();
    expect(arch!.role).toBeTruthy();
    expect(arch!.skills).toBeInstanceOf(Array);
    expect(arch!.guardrails.mustNot).toBeInstanceOf(Array);
    expect(arch!.guardrails.allowTools).toBeInstanceOf(Array);
  });

  it('includes Code Reviewer agent with role, skills, guardrails', () => {
    const cr = AGENTS.find((a) => a.name === 'Code Reviewer');
    expect(cr).toBeDefined();
    expect(cr!.role).toBeTruthy();
    expect(cr!.skills).toBeInstanceOf(Array);
    expect(cr!.guardrails.mustNot.length).toBeGreaterThan(0);
  });

  it('includes QA agent with role, skills, guardrails', () => {
    const qa = AGENTS.find((a) => a.name === 'QA');
    expect(qa).toBeDefined();
    expect(qa!.role).toBeTruthy();
    expect(qa!.skills).toBeInstanceOf(Array);
    expect(qa!.guardrails.mustNot.length).toBeGreaterThan(0);
  });

  it('each agent has valid runtimeConfig', () => {
    for (const agent of AGENTS) {
      expect(agent.runtimeConfig).toBeDefined();
      expect(['fast', 'balanced', 'deep']).toContain(agent.runtimeConfig.model);
      expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(agent.runtimeConfig.effort);
    }
  });

  it('each agent has guardrails', () => {
    for (const agent of AGENTS) {
      expect(agent.guardrails).toBeDefined();
      expect(agent.guardrails.mustNot).toBeInstanceOf(Array);
      expect(agent.guardrails.allowTools).toBeInstanceOf(Array);
    }
  });

  it('defines a distinct specialized system prompt for each agent', () => {
    const focusByAgent = {
      Manager: 'subtarefas',
      Produto: 'regras de negócio',
      Architecture: 'trade-offs',
      Engineer: 'causa raiz',
      'Code Reviewer': 'severidade',
      QA: 'cenários',
      Generic: 'tarefas simples',
    } as const;

    expect(new Set(getAgentNames())).toEqual(new Set(Object.keys(focusByAgent)));
    expect(new Set(AGENTS.map((agent) => agent.systemPrompt)).size).toBe(AGENTS.length);
    for (const [name, focus] of Object.entries(focusByAgent)) {
      expect(getAgentDefinition(name)?.systemPrompt).toContain(focus);
    }
  });

  it('getAgentDefinition returns agent by name', () => {
    expect(getAgentDefinition('Manager')).toBeDefined();
    expect(getAgentDefinition('NonExistent')).toBeUndefined();
  });

  it('getAgentNames returns all names', () => {
    const names = getAgentNames();
    expect(names).toHaveLength(AGENTS.length);
    expect(names).toContain('Manager');
  });

  it('Code Reviewer has read-only tools', () => {
    const cr = getAgentDefinition('Code Reviewer');
    expect(cr).toBeDefined();
    expect(cr!.tools).not.toContain('write');
    expect(cr!.tools).not.toContain('bash');
  });

  it('QA has bash for test execution but not write', () => {
    const qa = getAgentDefinition('QA');
    expect(qa).toBeDefined();
    expect(qa!.tools).toContain('bash');
    expect(qa!.tools).not.toContain('write');
  });
});
