import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleCommand, handleQuery, whyNotRunning } from "../../packages/orchestrator/src/index.js";
import { recoverStaleRuns, schedulerTick, semaphoreRequestsForTask } from "../../packages/orchestrator/src/scheduler.js";
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
  assert.equal(transitionTask(task, "block", { blockers: ["missing-input"] }).column, "manager");
  assert.equal(transitionTask(task, "block", { blockers: ["missing-input"] }).status, "queued");
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

test("runtime semaphore acquire is atomic under concurrent attempts", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-semaphore-race-"));
  const attempts = await Promise.all(Array.from({ length: 8 }, (_, index) => acquireSemaphoreLeases(
    [{ name: "resource:race", tokens: 1, capacity: 1 }],
    { root, taskId: `T${index}`, runId: `run-${index}`, role: "engineering" }
  )));
  assert.equal(attempts.filter((attempt) => attempt.ok).length, 1);
  assert.equal((await readSemaphoreState(root)).leases.filter((lease) => lease.name === "resource:race").length, 1);
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
    input: { title: "Runnable A", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued" }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "scheduler-create-b",
    input: { title: "Runnable B", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued" }
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

test("scheduler recovery fails running tasks whose prompt was not sent", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-recover-prompt-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "recover-prompt-create",
    input: { title: "Recover prompt", projectTargets: [] }
  }, root);
  const sessionRef = `settings/runtime/sessions/${created.task.id}/engineering/session.jsonl`;
  await mkdir(join(root, "settings", "runtime", "sessions", created.task.id, "engineering"), { recursive: true });
  await writeFile(join(root, sessionRef), `${JSON.stringify({ type: "agent.adapter", adapter: { promptSent: false } })}\n`);
  await handleCommand({
    type: "task.update",
    commandId: "recover-prompt-running",
    taskId: created.task.id,
    patch: { status: "running", agent: { currentRunId: "run-prompt-false", currentSessionRef: sessionRef } }
  }, root);
  const recovery = await recoverStaleRuns(root);
  assert.deepEqual(recovery.recovered.map((item) => item.taskId), [created.task.id]);
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.status, "failed");
  assert.equal(detail.failure.reason, "prompt_not_sent");
});

test("scheduler tick blocks dependent subtasks until contracts are provided", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-scheduler-dag-"));
  await handleCommand({
    type: "settings.update",
    commandId: "scheduler-dag-settings",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 3, agentTokens: { engineering: 3 }, projectTokens: { "kanban-code-agent": 3 } } }
  }, root);
  const first = await handleCommand({
    type: "task.create",
    commandId: "scheduler-dag-a",
    input: { title: "Provider", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued", dependencies: { needs: [], provides: ["contract:ready"], blockedBy: [], fileLocks: [], semaphores: [] } }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "scheduler-dag-b",
    input: { title: "Dependent", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "queued", dependencies: { needs: ["contract:ready"], provides: ["contract:done"], blockedBy: [], fileLocks: [], semaphores: [] } }
  }, root);
  const tick = await schedulerTick(root, {
    whyNotRunning,
    maxStarts: 3,
    runTask: (task) => handleCommand({ type: "task.run", commandId: `scheduler-dag-run-${task.id}`, taskId: task.id, agentId: "engineering" }, root)
  });
  assert.deepEqual(tick.started.map((item) => item.taskId), [first.task.id]);
  assert.equal(tick.skipped.some((item) => item.taskId === second.task.id && item.reasons.join(" ").includes("contract:ready")), true);
});
