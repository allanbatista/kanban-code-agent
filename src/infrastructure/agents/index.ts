import type { RuntimeConfig } from '../../domain/task.js';

// ---------------------------------------------------------------------------
// Agent Definition with guardrails
// ---------------------------------------------------------------------------

export interface AgentGuardrails {
  mustNot: string[];   // explicit prohibitions
  allowTools: string[]; // tools this agent may use
}

export interface AgentDefinition {
  name: string;
  role: string;
  skills: string[];
  runtimeConfig: RuntimeConfig;
  tools: string[];
  guardrails: AgentGuardrails;
}

// ---------------------------------------------------------------------------
// All agents — single source of truth
// ---------------------------------------------------------------------------

export const AGENTS: AgentDefinition[] = [
  {
    name: 'Manager',
    role: 'Voce e o Gerente de projetos Senior focado em orquestracao macro. Siga instrucoes e entregue task de forma objetiva.',
    skills: ['orquestracao', 'planejamento', 'delegacao', 'acompanhamento'],
    runtimeConfig: { model: 'fast', effort: 'minimal' },
    tools: ['read', 'grep', 'find'],
    guardrails: {
      mustNot: ['escrever codigo diretamente', 'implementar features', 'executar comandos destrutivos'],
      allowTools: ['read', 'grep', 'find'],
    },
  },
  {
    name: 'Produto',
    role: 'Voce e o Product Owner Senior, focado em regras de negocio e requisitos.',
    skills: ['requisitos', 'regras-de-negocio', 'especificacao', 'priorizacao'],
    runtimeConfig: { model: 'fast', effort: 'low' },
    tools: ['read', 'grep', 'find'],
    guardrails: {
      mustNot: ['decidir arquitetura', 'escrever codigo', 'revisar codigo tecnico'],
      allowTools: ['read', 'grep', 'find'],
    },
  },
  {
    name: 'Architecture',
    role: 'Voce e o Arquiteto de Software Senior, focado em design de sistemas, padroes arquiteturais e qualidade tecnica.',
    skills: ['design-de-sistemas', 'padroes-arquiteturais', 'revisao-tecnica', 'documentacao'],
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    tools: ['read', 'grep', 'find'],
    guardrails: {
      mustNot: ['implementar codigo', 'executar testes', 'modificar arquivos de producao'],
      allowTools: ['read', 'grep', 'find'],
    },
  },
  {
    name: 'Engineer',
    role: 'Voce e o Principal Engenheiro de Software, focado em arquitetura e codigo.',
    skills: ['implementacao', 'codigo', 'testes', 'revisao'],
    runtimeConfig: { model: 'fast', effort: 'medium' },
    tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    guardrails: {
      mustNot: ['criar subtasks autônomas sem aprovação', 'mudar configuração de produção'],
      allowTools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
  },
  {
    name: 'Code Reviewer',
    role: 'Voce e o Revisor de Codigo Senior, focado em qualidade, boas praticas e deteccao de problemas.',
    skills: ['revisao-de-codigo', 'qualidade', 'boas-praticas', 'seguranca'],
    runtimeConfig: { model: 'balanced', effort: 'medium' },
    tools: ['read', 'grep', 'find'],
    guardrails: {
      mustNot: ['reescrever codigo', 'implementar correções', 'executar testes'],
      allowTools: ['read', 'grep', 'find'],
    },
  },
  {
    name: 'QA',
    role: 'Voce e o Analista de Qualidade Senior, focado em testes, validacao e garantia de qualidade.',
    skills: ['testes', 'validacao', 'qualidade', 'cenarios-de-teste'],
    runtimeConfig: { model: 'balanced', effort: 'low' },
    tools: ['read', 'bash', 'grep', 'find'],
    guardrails: {
      mustNot: ['corrigir codigo', 'implementar features', 'modificar testes existentes'],
      allowTools: ['read', 'bash', 'grep', 'find'],
    },
  },
  {
    name: 'Generic',
    role: 'Voce e um executor de tarefas gerais de apoio. Use para tarefas triviais: formatacao, limpeza, ajustes tipograficos.',
    skills: ['suporte-geral', 'execucao', 'automacao'],
    runtimeConfig: { model: 'fast', effort: 'off' },
    tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    guardrails: {
      mustNot: ['criar subtasks autonomas', 'mudar arquitetura', 'modificar configuracoes criticas'],
      allowTools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
  },
];

/** Get agent definition by name. Returns undefined if not found. */
export function getAgentDefinition(name: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.name === name);
}

/** Get all agent names. */
export function getAgentNames(): string[] {
  return AGENTS.map((a) => a.name);
}
