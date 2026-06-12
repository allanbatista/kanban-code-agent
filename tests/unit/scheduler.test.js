import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleCommand, handleQuery, whyNotRunning } from "../../packages/orchestrator/src/index.js";
import { schedulerTick, semaphoreRequestsForTask } from "../../packages/orchestrator/src/scheduler.js";
import { transitionTask } from "../../packages/orchestrator/src/state-machine.js";
import { acquireSemaphoreLeases, readSemaphoreState, releaseSemaphoreLeases } from "../../packages/fsdb/src/runtime-store.js";

test("state machine applies core task transitions", () => {
  const task = {
    id: "KCA-SM",
    column: "build",
    status: "queued",
    routing: { currentAgent: "engineering", manualOverride: { active: false } },
    dependencies: { blockedBy: [] },
    agent: { currentRunId: "run-1" }
  };
  assert.equal(transitionTask(task, "start", { runId: "run-2", agentId: "engineering" }).status, "running");
  assert.equal(transitionTask(task, "complete", { nextColumn: "done" }).status, "done");
  assert.equal(transitionTask(task, "block", { blockers: ["missing-input"] }).dependencies.blockedBy[0], "missing-input");
  assert.equal(transitionTask(task, "manual_move", { toColumn: "validate" }).routing.manualOverride.active, true);
});

test("runtime semaphore store acquires and releases leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-semaphore-"));
  const first = await acquireSemaphoreLeases([{ name: "resource:package-json", tokens: 1 }], { root, taskId: "A", runId: "run-a", role: "engineering" });
  assert.equal(first.ok, true);
  const second = await acquireSemaphoreLeases([{ name: "resource:package-json", tokens: 1 }], { root, taskId: "B", runId: "run-b", role: "engineering" });
  assert.equal(second.ok, false);
  await releaseSemaphoreLeases({ root, runId: "run-a" });
  const third = await acquireSemaphoreLeases([{ name: "resource:package-json", tokens: 1 }], { root, taskId: "B", runId: "run-b", role: "engineering" });
  assert.equal(third.ok, true);
});

test("scheduler tick starts queued runnable tasks and records leases", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-scheduler-"));
  await handleCommand({
    type: "settings.update",
    commandId: "scheduler-settings",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 2, agentTokens: { engineering: 2 }, projectTokens: { "kanban-code-agent": 2 } } }
  }, root);
  const first = await handleCommand({
    type: "task.create",
    commandId: "scheduler-create-a",
    input: { title: "Runnable A", column: "build", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued" }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "scheduler-create-b",
    input: { title: "Runnable B", column: "build", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued" }
  }, root);
  assert.equal(semaphoreRequestsForTask(first.task, { runtime: {} }).some((request) => request.name === "global:tasks"), true);
  const tick = await schedulerTick(root, {
    whyNotRunning,
    maxStarts: 2,
    runTask: (task) => handleCommand({ type: "task.run", commandId: `scheduler-test-run-${task.id}`, taskId: task.id, agentId: "engineering" }, root)
  });
  assert.deepEqual(tick.started.map((item) => item.taskId).sort(), [first.task.id, second.task.id].sort());
  assert.equal((await handleQuery({ type: "task.detail", taskId: first.task.id }, root)).status, "running");
  assert.equal((await handleQuery({ type: "task.detail", taskId: second.task.id }, root)).status, "running");
  assert.equal((await readSemaphoreState(root)).leases.some((lease) => lease.taskId === first.task.id), true);
});
