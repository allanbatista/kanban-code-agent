export const ROLE_IDS = ["manager", "product", "design", "engineering", "quality", "review", "deployment"];

export const DEFAULT_ROLES = [
  {
    id: "manager",
    label: "Gerente",
    agentId: "manager",
    columnIds: ["inbox", "blocked"],
    tools: { custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: false },
    gate: "Task tem prioridade, dono, SLA e proxima acao."
  },
  {
    id: "product",
    label: "Produto",
    agentId: "product",
    columnIds: ["definition"],
    tools: { custom: ["request_user_input", "emit_artifact", "spawn_subtasks"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    gate: "Problema, valor, aceite e riscos de produto claros."
  },
  {
    id: "design",
    label: "Design",
    agentId: "design",
    columnIds: ["definition"],
    tools: { custom: ["request_user_input", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: true, requiresWorktree: false, autoStart: true },
    gate: "Fluxos, estados e impacto visual documentados."
  },
  {
    id: "engineering",
    label: "Engenharia",
    agentId: "engineering",
    columnIds: ["build"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact"] },
    limits: { tokens: 2 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    gate: "Codigo implementado com validacao local."
  },
  {
    id: "quality",
    label: "Qualidade",
    agentId: "quality",
    columnIds: ["validate"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    gate: "Criterios de aceite validados com evidencia."
  },
  {
    id: "review",
    label: "Review",
    agentId: "review",
    columnIds: ["review"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: true },
    gate: "Diff revisado e merge readiness decidido."
  },
  {
    id: "deployment",
    label: "Deployment",
    agentId: "deployment",
    columnIds: ["deploy", "done"],
    tools: { custom: ["complete_task", "report_blocker", "emit_artifact"] },
    limits: { tokens: 1 },
    policies: { canCreateSubtasks: false, requiresWorktree: true, autoStart: false },
    gate: "Release/deploy registrado com rollback conhecido."
  }
];

export function roleById(roleId) {
  return DEFAULT_ROLES.find((role) => role.id === roleId) || null;
}
