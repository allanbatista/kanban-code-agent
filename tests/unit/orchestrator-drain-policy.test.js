import test from "node:test";
import assert from "node:assert/strict";
import { shouldDrainSchedulerAfterCommand } from "../../packages/orchestrator/src/workflow-command-handlers.js";

test("task.decompose drains scheduler so runnable subtasks can start", () => {
  assert.equal(shouldDrainSchedulerAfterCommand({ type: "task.decompose" }), true);
});
