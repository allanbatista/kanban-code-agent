import { describe, it, expect } from 'vitest';
import { AGENTS } from '../../infrastructure/agents/index.js';

describe('Agent definitions', () => {
  it('exports all required agents', () => {
    const names = AGENTS.map((a) => a.name);
    expect(names).toContain('Manager');
    expect(names).toContain('Produto');
    expect(names).toContain('Generic');
    expect(names).toContain('Engineer');
  });

  it('includes Architecture agent with role, skills, promptTemplate', () => {
    const arch = AGENTS.find((a) => a.name === 'Architecture');
    expect(arch).toBeDefined();
    expect(arch!.role).toBeTruthy();
    expect(arch!.skills).toBeInstanceOf(Array);
    expect(arch!.promptTemplate).toBeTruthy();
  });

  it('includes Code Reviewer agent with role, skills, promptTemplate', () => {
    const cr = AGENTS.find((a) => a.name === 'Code Reviewer');
    expect(cr).toBeDefined();
    expect(cr!.role).toBeTruthy();
    expect(cr!.skills).toBeInstanceOf(Array);
    expect(cr!.promptTemplate).toBeTruthy();
  });

  it('includes QA agent with role, skills, promptTemplate', () => {
    const qa = AGENTS.find((a) => a.name === 'QA');
    expect(qa).toBeDefined();
    expect(qa!.role).toBeTruthy();
    expect(qa!.skills).toBeInstanceOf(Array);
    expect(qa!.promptTemplate).toBeTruthy();
  });

  it('each agent has valid runtimeConfig', () => {
    for (const agent of AGENTS) {
      expect(agent.runtimeConfig).toBeDefined();
      expect(['fast', 'balanced', 'deep']).toContain(agent.runtimeConfig.model);
      expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(agent.runtimeConfig.effort);
    }
  });
});
