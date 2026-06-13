export const ROLE_IDS = ["manager", "product", "design", "architecture", "generalist", "engineering", "quality", "review", "deployment"];

export const DEFAULT_ROLES = [
  {
    id: "manager",
    label: "Gerente",
    agentId: "manager",
    scope: "task",
    promptPath: "../prompts/manager.md",
    columnIds: ["manager", "human_wait"],
    tools: { custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "wait_for_persona", "delegate_task", "spawn_subtasks"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    model: { provider: "pi", name: "default", effort: "low" },
    gate: "Task foi classificada por tipo de trabalho e encaminhada para a primeira persona necessaria, evitando produto/decomposicao quando for trabalho direto."
  },
  {
    id: "product",
    label: "Produto",
    agentId: "product",
    scope: "task",
    promptPath: "../prompts/product.md",
    columnIds: ["product"],
    tools: { custom: ["request_user_input", "emit_artifact", "spawn_subtasks"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    model: { provider: "pi", name: "default", effort: "medium" },
    gate: "Problema, valor, aceite e riscos de produto claros."
  },
  {
    id: "design",
    label: "Design",
    agentId: "design",
    scope: "task",
    promptPath: "../prompts/design.md",
    columnIds: ["design"],
    tools: { custom: ["request_user_input", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    model: { provider: "pi", name: "default", effort: "medium" },
    gate: "Fluxos, estados e impacto visual documentados."
  },
  {
    id: "architecture",
    label: "Arquitetura",
    agentId: "architecture",
    scope: "task",
    promptPath: "../prompts/architecture.md",
    columnIds: ["architecture"],
    tools: { custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: true, autoStart: true },
    model: { provider: "pi", name: "default", effort: "high" },
    gate: "Plano tecnico, contratos internos, riscos e sequencia de implementacao claros."
  },
  {
    id: "generalist",
    label: "Generalista",
    agentId: "generalist",
    scope: "task",
    promptPath: "../prompts/generalist.md",
    columnIds: ["generalist"],
    tools: { custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    model: { provider: "pi", name: "default", effort: "low" },
    gate: "Trabalho nao-engenharia executado com evidencia ou escalado para a persona correta."
  },
  {
    id: "engineering",
    label: "Engenharia",
    agentId: "engineering",
    scope: "task",
    promptPath: "../prompts/engineering.md",
    columnIds: ["engineering"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact", "run_command"] },
    limits: { tokens: 2 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    model: { provider: "pi", name: "default", effort: "high" },
    gate: "Codigo implementado com validacao local."
  },
  {
    id: "quality",
    label: "Qualidade",
    agentId: "quality",
    scope: "task",
    promptPath: "../prompts/quality.md",
    columnIds: ["quality"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact", "run_command"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    model: { provider: "pi", name: "default", effort: "medium" },
    gate: "Criterios de aceite validados com evidencia."
  },
  {
    id: "review",
    label: "Review",
    agentId: "review",
    scope: "task",
    promptPath: "../prompts/review.md",
    columnIds: ["review"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact", "run_command"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    model: { provider: "pi", name: "default", effort: "medium" },
    gate: "Diff revisado e merge readiness decidido."
  },
  {
    id: "deployment",
    label: "Deployment",
    agentId: "deployment",
    scope: "task",
    promptPath: "../prompts/deployment.md",
    columnIds: ["deployment", "done"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: false },
    model: { provider: "pi", name: "default", effort: "low" },
    gate: "Release/deploy registrado com rollback conhecido."
  }
];

export function roleById(roleId) {
  return DEFAULT_ROLES.find((role) => role.id === roleId) || null;
}
