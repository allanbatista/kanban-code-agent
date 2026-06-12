import { columns, tasks, settings } from "../../core/src/fixtures.js";
import { commandEnvelope, queryEnvelope } from "../../core/src/contracts.js";
import { DEFAULT_ROLES } from "../../core/src/roles.js";

export function boardFixture(overrides = {}) {
  return {
    schema: "kanban-code-agent/state@1",
    columns: structuredClone(columns),
    tasks: structuredClone(tasks),
    settings: structuredClone(settings),
    ...overrides
  };
}

export function taskCreateCommand(input = {}) {
  return commandEnvelope("task.create", {
    input: {
      title: "Fixture task",
      projectTargets: ["kanban-code-agent"],
      ...input
    }
  });
}

export function boardSnapshotQuery() {
  return queryEnvelope("board.snapshot");
}

export function rolesFixture() {
  return structuredClone(DEFAULT_ROLES);
}

export function planningFixture(overrides = {}) {
  return {
    schema: "kanban-code-agent/planning@1",
    taskId: "KCA-200",
    status: "proposed",
    createdByRole: "product",
    roles: {
      required: ["product", "design", "engineering", "quality", "review", "deployment"],
      optional: ["manager"]
    },
    artifacts: {
      acceptance: "acceptance.md",
      design: "artifacts/design.md",
      technicalPlan: "plan.md"
    },
    ...overrides
  };
}

export function subtasksDagFixture(overrides = {}) {
  const nodes = [
    {
      id: "KCA-200-PRODUCT",
      role: "product",
      title: "Refinar aceite",
      needs: [],
      provides: ["contract:product-ready"],
      semaphores: ["agent:product"],
      fileLocks: ["tasks/KCA-200/acceptance.md"]
    },
    {
      id: "KCA-200-ENG-API",
      role: "engineering",
      title: "Implementar API",
      needs: ["contract:product-ready"],
      provides: ["service:api-ready"],
      semaphores: ["agent:engineering"],
      fileLocks: ["apps/daemon/**", "packages/orchestrator/**"]
    }
  ];
  return {
    schema: "kanban-code-agent/subtasks@2",
    parentTaskId: "KCA-200",
    strategy: "dag",
    mergePolicy: "sequential-into-parent-feature",
    nodes,
    subtasks: nodes,
    edges: [{ from: "KCA-200-PRODUCT", to: "KCA-200-ENG-API", contract: "contract:product-ready" }],
    ...overrides
  };
}
