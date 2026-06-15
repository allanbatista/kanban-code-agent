import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { handleCommand, handleQuery, whyNotRunning } from "../../packages/orchestrator/src/index.js";
import { recoverStaleRuns, reconcileOrchestrator, semaphoreRequestsForTask } from "../../packages/orchestrator/src/reconciler.js";
import { transitionTask } from "../../packages/orchestrator/src/state-machine.js";
import { acquireSemaphoreLeases, readSemaphoreState, releaseSemaphoreLeases } from "../../packages/fsdb/src/runtime-store.js";
import { updateTask } from "../../packages/fsdb/src/index.js";

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
  assert.equal(transitionTask(task, "complete", { nextColumn: "done" }).column, "done");
  assert.equal(transitionTask(task, "block", { blockers: ["missing-input"] }).column, "build");
  assert.equal(transitionTask(task, "block", { blockers: ["missing-input"] }).status, "blocked");
  assert.equal(transitionTask(task, "manual_move", { toColumn: "validate" }).routing.manualOverride.active, true);
  assert.equal(transitionTask(task, "manual_move", { toColumn: "validate" }).column, "build");
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

test("reconciler starts queued runnable tasks and records leases", async () => {
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
    input: { title: "Runnable A", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "idle" }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "scheduler-create-b",
    input: { title: "Runnable B", column: "inbox", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", manualOverride: { active: false } }, status: "idle" }
  }, root);
  const firstQueued = await handleCommand({ type: "task.update", commandId: "scheduler-queue-a", taskId: first.task.id, patch: { status: "queued" } }, root);
  const secondQueued = await handleCommand({ type: "task.update", commandId: "scheduler-queue-b", taskId: second.task.id, patch: { status: "queued" } }, root);
  const defaultRequests = semaphoreRequestsForTask(firstQueued.task, { runtime: {} });
  assert.equal(defaultRequests.some((request) => request.name === "global:tasks"), true);
  assert.equal(defaultRequests.find((request) => request.name === "agent:engineering").capacity, 50);
  assert.equal(semaphoreRequestsForTask(firstQueued.task, { runtime: { agentTokens: { engineering: 2 } } }).find((request) => request.name === "agent:engineering").capacity, 2);
  assert.equal(semaphoreRequestsForTask(firstQueued.task, { runtime: { agentTokens: { engineering: 2 } }, agentSettings: { limits: { maxParallelTasks: 7 } } }).find((request) => request.name === "agent:engineering").capacity, 7);
  const reconciled = await reconcileOrchestrator(root, {
    whyNotRunning,
    maxStarts: 2,
    runTask: (task) => handleCommand({ type: "task.update", commandId: `scheduler-test-run-${task.id}`, taskId: task.id, patch: { status: "running" } }, root)
  });
  assert.deepEqual(reconciled.started.map((item) => item.taskId).sort(), [firstQueued.task.id, secondQueued.task.id].sort());
  assert.equal((await handleQuery({ type: "task.detail", taskId: firstQueued.task.id }, root)).status, "running");
  assert.equal((await handleQuery({ type: "task.detail", taskId: secondQueued.task.id }, root)).status, "running");
  assert.equal((await readSemaphoreState(root)).leases.some((lease) => lease.taskId === firstQueued.task.id), true);
});

test("reconciler auto-queues eligible idle autoStart tasks only", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-scheduler-autostart-"));
  await handleCommand({
    type: "settings.update",
    commandId: "scheduler-autostart-settings",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 10, agentTokens: { product: 10 }, projectTokens: { "kanban-code-agent": 10 } } }
  }, root);
  const eligible = await handleCommand({
    type: "task.create",
    commandId: "scheduler-autostart-eligible",
    input: { title: "Eligible idle", column: "product", projectTargets: ["kanban-code-agent"], status: "idle", routing: { manualOverride: { active: false } } }
  }, root);
  await updateTask(eligible.task.id, { status: "idle", column: "product", routing: { manualOverride: { active: false } } }, root, "test.setup");

  const excluded = [];
  for (const [status, patch = {}] of [
    ["draft"],
    ["failed"],
    ["done"],
    ["running"],
    ["waiting"],
    ["waiting_human"],
    ["blocked"],
    ["idle", { routing: { manualOverride: { active: true } } }],
    ["idle", { dependencies: { needs: [], provides: [], blockedBy: ["human"], fileLocks: [], semaphores: [] } }]
  ]) {
    const created = await handleCommand({
      type: "task.create",
      commandId: `scheduler-autostart-${status}-${excluded.length}`,
      input: { title: `Excluded ${status} ${excluded.length}`, column: "product", projectTargets: ["kanban-code-agent"], status: "idle" }
    }, root);
    await handleCommand({
      type: "task.update",
      commandId: `scheduler-autostart-excluded-${excluded.length}`,
      taskId: created.task.id,
      patch: { status, routing: { manualOverride: { active: false } }, ...patch }
    }, root);
    excluded.push({ id: created.task.id, status, patch });
  }

  const reconciled = await reconcileOrchestrator(root, {
    whyNotRunning,
    maxStarts: 10,
    runTask: (task) => handleCommand({ type: "task.update", commandId: `scheduler-autostart-run-${task.id}`, taskId: task.id, patch: { status: "running" } }, root)
  });

  assert.deepEqual(reconciled.autoQueued, [eligible.task.id]);
  assert.deepEqual(reconciled.event.autoQueued, [eligible.task.id]);
  assert.equal(reconciled.event.type, "orchestrator.reconciled");
  assert.deepEqual(reconciled.started.map((item) => item.taskId), [eligible.task.id]);
  assert.equal((await handleQuery({ type: "task.detail", taskId: eligible.task.id }, root)).status, "running");
  for (const item of excluded) {
    const detail = await handleQuery({ type: "task.detail", taskId: item.id }, root);
    assert.equal(detail.status, item.status);
    assert.equal(detail.column, "product");
  }
});

test("human wait tasks are not runnable", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-human-wait-runnable-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "human-wait-create",
    input: { title: "Needs human", column: "manager", status: "waiting_human" }
  }, root);

  const why = await whyNotRunning(created.task, root);

  assert.equal(why.runnable, false);
  assert.deepEqual(why.reasons, ["Aguardando resposta humana."]);
});

test("queued tasks in same WIP column do not deadlock each other", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-wip-queued-"));
  const created = [];
  for (let index = 0; index < 4; index += 1) {
    const result = await handleCommand({
      type: "task.create",
      commandId: `wip-queued-${index}`,
      input: { title: `Queued ${index}`, column: "generalist", status: "idle", routing: { currentAgent: "generalist", currentRole: "generalist", manualOverride: { active: false } } }
    }, root);
    const queued = await handleCommand({
      type: "task.update",
      commandId: `wip-queued-update-${index}`,
      taskId: result.task.id,
      patch: { status: "queued", routing: { currentAgent: "generalist", currentRole: "generalist", manualOverride: { active: false } } }
    }, root);
    created.push(queued.task);
  }

  const why = await whyNotRunning(created[0], root);

  assert.equal(why.runnable, true);
  assert.equal(why.reasons.some((reason) => reason.includes("WIP da coluna generalist")), false);
});

test("reconciler recovery fails running tasks whose prompt was not sent", async () => {
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

test("reconciler blocks dependent subtasks until contracts are provided", async () => {
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
  const reconciled = await reconcileOrchestrator(root, {
    whyNotRunning,
    maxStarts: 3,
    runTask: (task) => handleCommand({ type: "task.run", commandId: `scheduler-dag-run-${task.id}`, taskId: task.id, agentId: "engineering" }, root)
  });
  assert.deepEqual(reconciled.started.map((item) => item.taskId), [first.task.id]);
  assert.equal(reconciled.skipped.some((item) => item.taskId === second.task.id && item.reasons.join(" ").includes("contract:ready")), true);
});
