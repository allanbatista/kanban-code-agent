import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { handleCommand, handleQuery } from "../../packages/orchestrator/src/index.js";
import { addProject } from "../../packages/fsdb/src/index.js";
import { createRepoFixture } from "../../packages/git-worktree/src/index.js";

test("orchestrator applies idempotent task create commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const command = {
    type: "task.create",
    commandId: "cmd-create-1",
    input: { title: "Contrato idempotente", projectTargets: ["kanban-code-agent"] }
  };
  const first = await handleCommand(command, root);
  const second = await handleCommand(command, root);
  assert.equal(first.task.id, second.task.id);
  assert.equal(second.idempotent, true);
});

test("orchestrator updates task and explains why it is not running", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-create-2",
    input: { title: "Aguardar contrato", projectTargets: ["kanban-code-agent"] }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-update-2",
    taskId: created.task.id,
    patch: { status: "queued", dependencies: { ...created.task.dependencies, needs: ["contract:fsdb"] } }
  }, root);
  const why = await handleQuery({ type: "why_not_running", taskId: created.task.id }, root);
  assert.equal(why.runnable, false);
  assert.match(why.reasons.join(" "), /contract:fsdb/);
});

test("orchestrator starts, completes and summarizes a task session", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-create-3",
    input: { title: "Executar agent", projectTargets: ["kanban-code-agent"] }
  }, root);
  const started = await handleCommand({
    type: "task.run",
    commandId: "cmd-run-3",
    taskId: created.task.id,
    agentId: "engineer"
  }, root);
  assert.equal(started.task.status, "running");
  assert.match(started.run.sessionRef, /settings\/runtime\/sessions/);
  const session = await readFile(join(root, "settings", "runtime", "sessions", created.task.id, "engineer", "session.jsonl"), "utf8");
  assert.match(session, /agent.config/);
  assert.match(session, /agent.run/);
  assert.match(session, /promptHash/);
  assert.match(session, /allowedTools/);

  const completed = await handleCommand({
    type: "agent.complete_task",
    commandId: "cmd-complete-3",
    taskId: created.task.id,
    runId: started.run.runId,
    nextColumn: "validate",
    summary: "Implementado e pronto para validação."
  }, root);
  assert.equal(completed.task.column, "validate");
  assert.equal(completed.task.status, "validating");
  assert.match(completed.summaryRef, /summaries\/run-/);

  const resumed = await handleCommand({
    type: "task.run",
    commandId: "cmd-run-3-resume",
    taskId: completed.task.id,
    agentId: "engineer"
  }, root);
  assert.equal(resumed.run.previousSessionRef, started.run.sessionRef);
  assert.equal(resumed.run.previousSummaryRef, completed.summaryRef);
  assert.match(await readFile(join(root, "settings", "runtime", "sessions", created.task.id, "engineer", "session.jsonl"), "utf8"), /previousSummaryRef/);
});

test("all default agents load editable prompts and can start sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-agents-"));
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-agent-capacity",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 20, agentTokens: { assistant: 2, architect: 2, engineer: 2, validator: 2, reviewer: 2, "hook-agent": 2 }, projectTokens: { "kanban-code-agent": 20 } } }
  }, root);
  const agents = ["assistant", "architect", "engineer", "validator", "reviewer", "hook-agent"];
  for (const agentId of agents) {
    const created = await handleCommand({
      type: "task.create",
      commandId: `cmd-agent-${agentId}`,
      input: { title: `Agent ${agentId}`, projectTargets: ["kanban-code-agent"] }
    }, root);
    const started = await handleCommand({
      type: "task.run",
      commandId: `cmd-agent-run-${agentId}`,
      taskId: created.task.id,
      agentId
    }, root);
    assert.equal(started.run.agentId, agentId);
    const session = await readFile(join(root, "settings", "runtime", "sessions", created.task.id, agentId, "session.jsonl"), "utf8");
    assert.match(session, new RegExp(`"id":"${agentId}"`));
    assert.match(session, /promptPreview/);
  }
});

test("assistant chat creates an agent session and can create tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-chat-"));
  const result = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat",
    scope: "board",
    agentId: "assistant",
    prompt: "criar task Cobrir chat agent"
  }, root);
  assert.equal(result.ok, true);
  assert.equal(result.run.agentId, "assistant");
  assert.equal(result.action.type, "task.created");
  const snapshot = await handleQuery({ type: "board.snapshot" }, root);
  assert.equal(snapshot.tasks.some((task) => task.title === "Cobrir chat agent"), true);
  assert.equal(snapshot.events.some((event) => event.type === "agent.event" && event.actor === "assistant"), true);
  const history = await handleQuery({ type: "chat.history", scope: "board" }, root);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, "user");
  assert.equal(history[1].role, "assistant");
});

test("assistant chat can move and rename the selected task", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-chat-move-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-agent-chat-selected-create",
    input: { title: "Selecionada", projectTargets: ["kanban-code-agent"] }
  }, root);
  const moved = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-move",
    scope: "board",
    agentId: "assistant",
    selectedTaskId: created.task.id,
    prompt: "mover para build"
  }, root);
  assert.equal(moved.action.type, "task.moved");
  assert.equal(moved.action.column, "build");

  const renamed = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-rename",
    scope: "task",
    agentId: "assistant",
    taskId: created.task.id,
    prompt: "renomear para Nome final"
  }, root);
  assert.equal(renamed.action.type, "task.updated");
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.title, "Nome final");
});

test("task assistant can update acceptance and decompose by task scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-chat-task-scope-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-agent-chat-task-create",
    input: { title: "Task scoped assistant", projectTargets: ["kanban-code-agent"] }
  }, root);
  const acceptance = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-acceptance",
    scope: "task",
    agentId: "assistant",
    taskId: created.task.id,
    prompt: "alterar aceite para Validar persistencia do chat"
  }, root);
  assert.equal(acceptance.action.type, "acceptance.updated");
  assert.match(await readFile(join(root, "tasks", created.task.id, "acceptance.md"), "utf8"), /Validar persistencia do chat/);

  const decomposed = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-decompose",
    scope: "task",
    agentId: "assistant",
    taskId: created.task.id,
    prompt: "decompor em subtasks"
  }, root);
  assert.equal(decomposed.action.type, "subtasks.spawned");
  const snapshot = await handleQuery({ type: "board.snapshot" }, root);
  assert.equal(snapshot.tasks.some((task) => task.id === `${created.task.id}-01`), true);
});

test("manual override rejects stale agent completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-stale-create",
    input: { title: "Resultado atrasado", projectTargets: ["kanban-code-agent"] }
  }, root);
  const started = await handleCommand({
    type: "task.run",
    commandId: "cmd-stale-run",
    taskId: created.task.id,
    agentId: "engineer"
  }, root);
  await handleCommand({
    type: "task.interrupt",
    commandId: "cmd-stale-interrupt",
    taskId: created.task.id,
    mode: "hard"
  }, root);
  await assert.rejects(
    () => handleCommand({
      type: "agent.complete_task",
      commandId: "cmd-stale-complete",
      taskId: created.task.id,
      runId: started.run.runId,
      nextColumn: "done",
      summary: "late"
    }, root),
    /manual_override_active/
  );
});

test("task run creates configured project worktree and merge command blocks invalid parent", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "kca-git-orch-"));
  const fixture = await createRepoFixture({ root: fixtureRoot, name: "repo" });
  if (fixture.status === "skipped") return;

  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  await addProject({ id: "repo", repo: fixture.repoPath }, root);
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-worktree-create",
    input: { title: "Worktree task", projectTargets: ["repo"] }
  }, root);
  const started = await handleCommand({
    type: "task.run",
    commandId: "cmd-worktree-run",
    taskId: created.task.id,
    agentId: "engineer"
  }, root);
  assert.match(started.task.worktree.path, /settings\/runtime\/worktrees|kca-orch-/);

  const merge = await handleCommand({
    type: "task.merge",
    commandId: "cmd-merge-invalid",
    taskId: created.task.id,
    parentPath: fixture.repoPath,
    subtaskBranch: "kca/missing"
  }, root);
  assert.equal(merge.ok, false);
  assert.equal(merge.task.status, "blocked");
});

test("merge command is sequential per parent task", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const first = await handleCommand({
    type: "task.create",
    commandId: "cmd-merge-busy-a",
    input: { title: "Merge A", kind: "subtask", worktree: { enabled: true, kind: "subtask", branch: "kca/a", parentTaskId: "KCA-parent" } }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "cmd-merge-busy-b",
    input: { title: "Merge B", kind: "subtask", worktree: { enabled: true, kind: "subtask", branch: "kca/b", parentTaskId: "KCA-parent" } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-merge-busy-a-update",
    taskId: first.task.id,
    patch: { status: "merge_pending" }
  }, root);
  const blocked = await handleCommand({
    type: "task.merge",
    commandId: "cmd-merge-busy-b-run",
    taskId: second.task.id,
    parentPath: "/tmp/not-used",
    subtaskBranch: "kca/b"
  }, root);
  assert.equal(blocked.merge.reason, "parent_merge_busy");
  assert.equal(blocked.task.status, "blocked");
});

test("orchestrator blocks run when file locks conflict", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const first = await handleCommand({
    type: "task.create",
    commandId: "cmd-lock-a",
    input: { title: "Task A", projectTargets: ["kanban-code-agent"] }
  }, root);
  const second = await handleCommand({
    type: "task.create",
    commandId: "cmd-lock-b",
    input: { title: "Task B", projectTargets: ["kanban-code-agent"] }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-lock-a-update",
    taskId: first.task.id,
    patch: { status: "running", dependencies: { ...first.task.dependencies, fileLocks: ["packages/core/**"] } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-lock-b-update",
    taskId: second.task.id,
    patch: { status: "queued", dependencies: { ...second.task.dependencies, fileLocks: ["packages/core/**"] } }
  }, root);
  const run = await handleCommand({
    type: "task.run",
    commandId: "cmd-lock-b-run",
    taskId: second.task.id,
    agentId: "engineer"
  }, root);
  assert.equal(run.ok, false);
  assert.match(run.why.reasons.join(" "), /packages\/core/);
});

test("orchestrator decomposes a master task into queued subtasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const parent = await handleCommand({
    type: "task.create",
    commandId: "cmd-master",
    input: { title: "Feature master", kind: "master", projectTargets: ["kanban-code-agent"] }
  }, root);
  const decomposed = await handleCommand({
    type: "task.decompose",
    commandId: "cmd-decompose",
    taskId: parent.task.id,
    subtasks: [
      { title: "Implementar runtime", needs: [], provides: ["runtime:agent"], fileLocks: ["packages/agent-runtime/**"], agentId: "engineer" },
      { title: "Validar runtime", needs: ["runtime:agent"], provides: ["runtime:validated"], fileLocks: ["tests/**"], agentId: "validator" }
    ]
  }, root);
  assert.equal(decomposed.subtasks.length, 2);
  assert.equal(decomposed.subtasks[0].kind, "subtask");
  assert.equal(decomposed.subtasks[0].worktree.parentTaskId, parent.task.id);
  assert.equal(decomposed.subtasks[1].dependencies.needs[0], "runtime:agent");
  const subtasksFile = YAML.parse(await readFile(join(root, "tasks", parent.task.id, "subtasks.yaml"), "utf8"));
  assert.equal(subtasksFile.parentTaskId, parent.task.id);
  assert.equal(subtasksFile.subtasks[0].id, decomposed.subtasks[0].id);
  assert.deepEqual(subtasksFile.subtasks[1].needs, ["runtime:agent"]);
  assert.deepEqual(subtasksFile.subtasks[1].fileLocks, ["tests/**"]);
  assert.equal((await handleQuery({ type: "why_not_running", taskId: decomposed.subtasks[0].id }, root)).runnable, true);
  assert.match((await handleQuery({ type: "why_not_running", taskId: decomposed.subtasks[1].id }, root)).reasons.join(" "), /runtime:agent/);
});

test("scheduler explains global limits, agent/project tokens and semaphores", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  await handleCommand({ type: "settings.update", commandId: "cmd-settings-limits", scope: "app", patch: { runtime: { maxParallelTasks: 1, agentTokens: { engineer: 1 }, projectTokens: { "kanban-code-agent": 1 } } } }, root);
  const running = await handleCommand({
    type: "task.create",
    commandId: "cmd-running-limit",
    input: { title: "Running", projectTargets: ["kanban-code-agent"] }
  }, root);
  const queued = await handleCommand({
    type: "task.create",
    commandId: "cmd-queued-limit",
    input: { title: "Queued", projectTargets: ["kanban-code-agent"] }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-running-limit-update",
    taskId: running.task.id,
    patch: { status: "running", routing: { ...running.task.routing, currentAgent: "engineer" }, dependencies: { ...running.task.dependencies, semaphores: [{ name: "global:merge", tokens: 1 }] } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-queued-limit-update",
    taskId: queued.task.id,
    patch: { status: "queued", routing: { ...queued.task.routing, currentAgent: "engineer" }, dependencies: { ...queued.task.dependencies, semaphores: [{ name: "global:merge", tokens: 1 }] } }
  }, root);
  const why = await handleQuery({ type: "why_not_running", taskId: queued.task.id }, root);
  assert.match(why.reasons.join(" "), /Limite global/);
  assert.match(why.reasons.join(" "), /Tokens do agent engineer/);
  assert.match(why.reasons.join(" "), /Tokens de projeto/);
  assert.match(why.reasons.join(" "), /global:merge/);

  const status = await handleQuery({ type: "orchestrator.status" }, root);
  assert.equal(status.schema, "kanban-code-agent/orchestrator-status@1");
  assert.equal(status.capacity.running, 1);
  assert.deepEqual(status.queue, [queued.task.id]);
});

test("settings scopes map to concrete settings files", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const workspace = await handleQuery({ type: "settings.scope", scope: "workspace" }, root);
  assert.equal(workspace.workspace.name, "Kanban Code Agent");

  const columns = await handleQuery({ type: "settings.scope", scope: "columns" }, root);
  assert.equal(columns.columns.length, 6);

  const agentUpdate = await handleCommand({
    type: "settings.update",
    commandId: "cmd-agent-settings",
    scope: "agents",
    patch: { id: "engineer", limits: { tokens: 3 }, skills: ["implementation", "testing"] }
  }, root);
  assert.equal(agentUpdate.settings.limits.tokens, 3);
  assert.match(await readFile(join(root, "settings", "agents", "engineer.yaml"), "utf8"), /tokens: 3/);

  const agents = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  assert.equal(agents.agents.some((agent) => agent.id === "engineer" && agent.limits.tokens === 3), true);

  const boardUpdate = await handleCommand({
    type: "settings.update",
    commandId: "cmd-board-settings",
    scope: "columns",
    patch: { columns: [{ id: "inbox", label: "Entrada", wip: 1, wipLimit: 1 }] }
  }, root);
  assert.equal(boardUpdate.settings.columns[0].wipLimit, 1);
  assert.match(await readFile(join(root, "settings", "boards", "default.yaml"), "utf8"), /wipLimit: 1/);
});

test("orchestrator runs hooks on move and supports input/artifact tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-hooks-create",
    input: { title: "Hooks e tools", projectTargets: ["kanban-code-agent"], hooks: { active: ["summarize-blocker"] } }
  }, root);
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-hooks-move",
    taskId: created.task.id,
    toColumn: "validate"
  }, root);
  assert.equal(moved.hooks.length, 2);
  assert.match(await readFile(join(root, "tasks", created.task.id, "summaries", "blocker.md"), "utf8"), /Hook summarize-blocker|Resumir bloqueio|summarize-blocker/);

  const artifact = await handleCommand({
    type: "agent.emit_artifact",
    commandId: "cmd-artifact",
    taskId: created.task.id,
    path: "evidence.md",
    content: "Evidência objetiva."
  }, root);
  assert.match(await readFile(join(root, "tasks", created.task.id, artifact.artifactPath), "utf8"), /Evidência objetiva/);

  const input = await handleCommand({
    type: "agent.request_user_input",
    commandId: "cmd-input",
    taskId: created.task.id,
    question: "Aprovar merge?"
  }, root);
  assert.equal(input.task.status, "blocked");
  assert.match(await readFile(join(root, "tasks", created.task.id, input.inputPath), "utf8"), /Aprovar merge/);
});

test("orchestrator executes command hooks with timeout and persists output", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-command-hook-settings",
    scope: "hooks",
    patch: {
      id: "echo-task",
      label: "Echo task",
      kind: "command",
      trigger: "onEnter",
      command: {
        command: process.execPath,
        args: ["-e", "process.stdout.write(process.env.KCA_TASK_ID)"]
      },
      outputs: { writeSummaryTo: "summaries/echo-task.md" },
      timeoutMs: 5000
    }
  }, root);
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-command-hook-create",
    input: { title: "Command hook", hooks: { active: ["echo-task"] } }
  }, root);
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-command-hook-move",
    taskId: created.task.id,
    toColumn: "validate"
  }, root);
  assert.equal(moved.hooks.some((event) => event.type === "hook.completed" && event.stdout === created.task.id), true);
  assert.match(await readFile(join(root, "tasks", created.task.id, "summaries", "echo-task.md"), "utf8"), new RegExp(created.task.id));
});
