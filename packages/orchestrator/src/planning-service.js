export function planningArtifactsForTask(task, roles = ["product", "design", "engineering", "quality", "review", "deployment"]) {
  return {
    planning: {
      schema: "kanban-code-agent/planning@1",
      taskId: task.id,
      status: "draft",
      createdByRole: "product",
      roles: { required: roles, optional: ["manager"] },
      artifacts: {
        acceptance: "acceptance.md",
        design: "artifacts/design.md",
        technicalPlan: "plan.md"
      }
    },
    acceptance: `# Critérios de aceite\n\n- [ ] ${task.title} funciona de ponta a ponta com evidencia.\n`
  };
}
