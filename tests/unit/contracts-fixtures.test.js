import test from "node:test";
import assert from "node:assert/strict";
import { COMMAND_TYPES, EVENT_TYPES, QUERY_TYPES, ROLE_IDS, commandEnvelope, queryEnvelope } from "../../packages/core/src/contracts.js";
import { boardFixture, boardSnapshotQuery, planningFixture, rolesFixture, subtasksDagFixture, taskCreateCommand } from "../../packages/test-fixtures/src/index.js";

test("core contracts expose canonical command, query and event names", () => {
  assert.equal(COMMAND_TYPES.includes("task.create"), true);
  assert.equal(COMMAND_TYPES.includes("scheduler.tick"), true);
  assert.equal(QUERY_TYPES.includes("board.snapshot"), true);
  assert.equal(EVENT_TYPES.includes("task.recovered"), true);
  assert.equal(ROLE_IDS.includes("deployment"), true);
  assert.equal(commandEnvelope("task.move", { taskId: "KCA-1" }).type, "task.move");
  assert.equal(queryEnvelope("why_not_running", { taskId: "KCA-1" }).taskId, "KCA-1");
});

test("test fixtures provide reusable board and command inputs", () => {
  const board = boardFixture();
  const command = taskCreateCommand({ title: "Fixture personalizada" });
  assert.equal(board.columns.length, 6);
  assert.equal(rolesFixture().length, 7);
  assert.equal(planningFixture().roles.required.includes("deployment"), true);
  assert.equal(subtasksDagFixture().edges[0].contract, "contract:product-ready");
  assert.equal(command.input.title, "Fixture personalizada");
  assert.equal(boardSnapshotQuery().type, "board.snapshot");
});
