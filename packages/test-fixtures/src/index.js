import { columns, tasks, settings } from "../../core/src/fixtures.js";
import { commandEnvelope, queryEnvelope } from "../../core/src/contracts.js";

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
