import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CommandBus, EventBus, QueryBus } from "../../packages/application/src/index.js";
import { createBoardService } from "../../packages/board-service/src/index.js";
import { createFsdbRepositories } from "../../packages/fsdb/src/repositories/index.js";
import { createRunnabilityService } from "../../packages/orchestrator/src/runnability-service.js";
import { createMemoryRepositories } from "../../packages/test-fixtures/src/memory-repositories.js";
import { createTaskService } from "../../packages/task-service/src/index.js";

test("BoardService serves snapshots and task details through FSDB repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-board-service-"));
  const boardService = createBoardService(root);
  const taskService = createTaskService(root, { boardService });
  const task = await taskService.createTask({ title: "Board service task", projectTargets: [] });
  const snapshot = await boardService.snapshot();
  assert.equal(snapshot.tasks.some((item) => item.id === task.id), true);
  assert.equal((await boardService.taskDetail(task.id)).title, "Board service task");
  assert.equal((await boardService.taskFiles(task.id)).files.includes("task.yaml"), true);
});

test("TaskService supports memory repositories for create, update, move and file write", async () => {
  const repositories = createMemoryRepositories({ board: { columns: [{ id: "product", label: "Product", autoStart: true, agent: "product", role: "product" }] } });
  const events = new EventBus();
  const seen = [];
  events.subscribe("*", (event) => seen.push(event.type));
  const taskService = createTaskService(null, { repositories, eventBus: events });
  const task = await taskService.createTask({ title: "Memory task", projectTargets: [] });
  assert.equal(task.title, "Memory task");
  assert.equal((await taskService.updateTask(task.id, { title: "Updated" })).title, "Updated");
  assert.equal((await taskService.moveTask(task.id, "product")).task.status, "queued");
  assert.equal((await taskService.writeTaskFile(task.id, "acceptance.md", "ok")).path, "acceptance.md");
  assert.deepEqual(seen.includes("TaskCreated"), true);
});

test("FSDB repositories expose command result and settings ports", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-repositories-"));
  const repositories = createFsdbRepositories(root);
  const task = await repositories.tasks.create({ title: "Repo task", projectTargets: [] });
  assert.equal(await repositories.tasks.exists(task.id), true);
  await repositories.commandResults.put("cmd-repo", { ok: true });
  assert.equal((await repositories.commandResults.get("cmd-repo")).ok, true);
  assert.equal((await repositories.settings.readScope("app")).schema, "kanban-code-agent/app@1");
});

test("QueryBus routes board.snapshot outside orchestrator", async () => {
  const repositories = createMemoryRepositories();
  const boardService = createBoardService(null, { repositories });
  const bus = new QueryBus({ handlers: { "board.snapshot": () => boardService.snapshot() } });
  assert.equal((await bus.execute({ type: "board.snapshot" })).schema, "kanban-code-agent/state@1");
});

test("CommandBus preserves idempotency through result store", async () => {
  const repositories = createMemoryRepositories();
  let calls = 0;
  const bus = new CommandBus({
    resultStore: repositories.commandResults,
    handlers: {
      "task.create": async (command) => {
        calls += 1;
        return { ok: true, commandId: command.commandId, task: { id: "KCA-1" } };
      }
    }
  });
  const command = { type: "task.create", commandId: "cmd-idem", input: { title: "Idempotent" } };
  assert.equal((await bus.execute(command)).task.id, "KCA-1");
  assert.equal((await bus.execute(command)).idempotent, true);
  assert.equal(calls, 1);
});

test("RunnabilityService keeps dependency explanations machine-owned", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-runnable-"));
  const repositories = createFsdbRepositories(root);
  const task = await repositories.tasks.create({ title: "Needs contract", status: "queued", dependencies: { needs: ["contract:x"], provides: [], blockedBy: [], fileLocks: [], semaphores: [] } });
  const service = createRunnabilityService(root);
  const why = await service.explain(task);
  assert.equal(why.runnable, false);
  assert.match(why.reasons.join(" "), /contract:x/);
});
