import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import { handleCommand, handleQuery } from "../../packages/orchestrator/src/index.js";
import { planningArtifactsForTask } from "../../packages/orchestrator/src/planning-service.js";
import { addProject, appendJsonl, boardSnapshot, initStorage, paths, refreshOpenRouterModelCache } from "../../packages/fsdb/src/index.js";
import { readTaskComments } from "../../packages/fsdb/src/chat-store.js";
import { createRepoFixture } from "../../packages/git-worktree/src/index.js";
import { buildAgentChat } from "../../packages/agent-runtime/src/index.js";

const realOrchestratorPromptSmokeEnabled = process.env.KCA_PI_ORCH_PROMPT_SMOKE === "1";

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

test("moving a task into an autoStart column drains the scheduler", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-auto-start-move-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-auto-start-create",
    input: { title: "Auto start on definition", column: "inbox", projectTargets: ["kanban-code-agent"] }
  }, root);
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-auto-start-move",
    taskId: created.task.id,
    toColumn: "definition"
  }, root);
  assert.equal(moved.task.column, "product");
  assert.equal(moved.task.status, "queued");
  assert.equal(moved.task.routing.currentRole, "product");
  assert.deepEqual(moved.scheduler.started.map((item) => item.taskId), [created.task.id]);
  assert.equal((await handleQuery({ type: "task.detail", taskId: created.task.id }, root)).status, "running");
});

test("creating a task directly in an autoStart column drains the scheduler", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-auto-start-create-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-direct-auto-start-create",
    input: { title: "Auto start direct create", column: "product", projectTargets: [] }
  }, root);
  assert.equal(created.task.column, "product");
  assert.equal(created.task.status, "queued");
  assert.equal(created.task.routing.currentRole, "product");
  assert.deepEqual(created.scheduler.started.map((item) => item.taskId), [created.task.id]);
  assert.equal((await handleQuery({ type: "task.detail", taskId: created.task.id }, root)).status, "running");
});

test("draft tasks stay hidden until moved and support attachments", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-draft-task-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-draft-create",
    input: { title: "", description: "Implementar fluxo draft", column: "inbox", draft: true, projectTargets: [] }
  }, root);
  assert.equal(created.task.status, "draft");
  assert.equal(created.task.title, "Implementar fluxo draft");
  assert.equal(created.scheduler, undefined);
  assert.equal((await handleQuery({ type: "board.snapshot" }, root)).tasks.some((task) => task.id === created.task.id), false);

  const uploaded = await handleCommand({
    type: "task.attachment.write",
    commandId: "cmd-draft-attachment",
    taskId: created.task.id,
    fileName: "../clipboard image.png",
    contentType: "image/png",
    dataBase64: Buffer.from("png-data").toString("base64")
  }, root);
  assert.match(uploaded.path, /^attachments\/\d+-clipboard-image\.png$/);
  assert.equal(await readFile(join(paths(root).tasks, created.task.id, uploaded.path), "utf8"), "png-data");
  const draftFiles = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(draftFiles.files.includes(uploaded.path), true);
  assert.equal(draftFiles.fileEntries.find((file) => file.path === uploaded.path)?.kind, "image");

  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-draft-move",
    taskId: created.task.id,
    toColumn: "manager"
  }, root);
  assert.equal(moved.task.column, "manager");
  assert.equal(moved.task.status, "queued");
  assert.equal(moved.task.routing.currentRole, "manager");
  assert.equal((await handleQuery({ type: "board.snapshot" }, root)).tasks.some((task) => task.id === created.task.id), true);
});

test("manager task without title infers title from actionable prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-title-infer-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-title-infer",
    input: { title: "", description: "Implementar fluxo de login com validacao de email", projectTargets: [] }
  }, root);
  assert.equal(created.task.title, "Implementar fluxo de login com validacao de email");
  assert.equal(created.task.column, "manager");
  assert.equal(created.task.status, "queued");
});

test("manager task without actionable title waits for human input", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-title-human-wait-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-title-human-wait",
    input: { title: "", description: "preciso de ajuda", projectTargets: [] }
  }, root);
  assert.equal(created.task.title, "Aguardando detalhes da tarefa");
  assert.equal(created.task.column, "human_wait");
  assert.equal(created.task.status, "idle");
  assert.equal(created.scheduler, undefined);
  assert.match(await readFile(join(paths(root).tasks, created.task.id, "comments.jsonl"), "utf8"), /Preciso de mais informações/);
  assert.match(await readFile(join(paths(root).tasks, created.task.id, "events.jsonl"), "utf8"), /missing_actionable_task_intent/);
});

test("moving a running task into an autoStart column queues the target agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-running-move-autostart-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-running-move-create",
    input: { title: "Running move", column: "product", status: "queued", routing: { currentAgent: "product", currentRole: "product", manualOverride: { active: false } } }
  }, root);
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.status, "running");
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), { ts: new Date().toISOString(), type: "gate.failed", actor: "quality", taskId: created.task.id, reason: "status:queued" });
  assert.equal((await handleQuery({ type: "task.detail", taskId: created.task.id }, root)).failure.reason, "status:queued");
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-running-move-manager",
    taskId: created.task.id,
    toColumn: "manager"
  }, root);
  assert.equal(moved.task.column, "manager");
  assert.equal(moved.task.status, "queued");
  assert.equal(moved.task.routing.currentAgent, "manager");
  assert.equal(moved.task.routing.currentRole, "manager");
  assert.equal(moved.task.routing.manualOverride.active, false);
  assert.deepEqual(moved.scheduler.started.map((item) => item.taskId), [created.task.id]);
  const latest = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(latest.status, "running");
  assert.equal(latest.routing.currentAgent, "manager");
  assert.equal(latest.failure, undefined);
});

test("moving a task to the same column is a no-op without scheduler drain", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-same-column-move-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-same-column-create",
    input: { title: "Same column move", column: "inbox", projectTargets: [] }
  }, root);
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-same-column-move",
    taskId: created.task.id,
    toColumn: "inbox"
  }, root);
  assert.equal(moved.noop, true);
  assert.equal(moved.scheduler, undefined);
  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(files.events.some((event) => event.type === "task.moved"), false);
});

test("moving a task to inbox clears active agent and leaves it idle", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-inbox-special-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-inbox-special-create",
    input: { title: "Inbox special", column: "product", status: "queued", routing: { currentAgent: "product", currentRole: "product", lastAgent: "engineering", lastRole: "engineering", manualOverride: { active: false } } }
  }, root);
  assert.equal((await handleQuery({ type: "task.detail", taskId: created.task.id }, root)).status, "running");
  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-inbox-special-move",
    taskId: created.task.id,
    toColumn: "inbox"
  }, root);
  assert.equal(moved.task.column, "inbox");
  assert.equal(moved.task.status, "idle");
  assert.equal(moved.task.routing.currentAgent, null);
  assert.equal(moved.task.routing.currentRole, null);
  assert.equal(moved.task.routing.lastAgent, "engineering");
  assert.equal(moved.task.routing.lastRole, "engineering");
  assert.equal(moved.task.routing.manualOverride.active, false);
  assert.equal(moved.scheduler.started.length, 0);
});

test("moving to legacy definition column keeps task visible on that board", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-legacy-definition-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-legacy-definition-create",
    input: { title: "Legacy definition move", column: "inbox", projectTargets: [] }
  }, root);
  const boardPath = join(root, "settings", "boards", "default.yaml");
  const board = YAML.parse(await readFile(boardPath, "utf8"));
  board.columns = board.columns.map((column) => column.id === "product" ? { ...column, id: "definition", label: "Definição" } : column);
  await writeFile(boardPath, YAML.stringify(board));

  const moved = await handleCommand({
    type: "task.move",
    commandId: "cmd-legacy-definition-move",
    taskId: created.task.id,
    toColumn: "definition"
  }, root);
  const snapshot = await handleQuery({ type: "board.snapshot" }, root);
  assert.equal(moved.task.column, "definition");
  assert.equal(snapshot.columns.some((column) => column.id === "definition"), true);
  assert.equal(snapshot.tasks.find((task) => task.id === created.task.id)?.column, "definition");
});

test("orchestrator starts, completes and summarizes a task session", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-create-3",
    input: { title: "Executar agent", column: "inbox", projectTargets: ["kanban-code-agent"] }
  }, root);
  const started = await handleCommand({
    type: "task.run",
    commandId: "cmd-run-3",
    taskId: created.task.id,
    agentId: "engineering"
  }, root);
  assert.equal(started.task.status, "running");
  assert.match(started.run.sessionRef, /settings\/runtime\/sessions/);
  const session = await readFile(join(root, "settings", "runtime", "sessions", created.task.id, "engineering", "session.jsonl"), "utf8");
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
  assert.equal(completed.task.column, "quality");
  assert.equal(completed.task.status, "queued");
  assert.match(completed.summaryRef, /summaries\/run-/);
  const autoRun = completed.scheduler.started.find((item) => item.taskId === created.task.id)?.result;
  assert.equal(autoRun.run.previousSessionRef, started.run.sessionRef);
  assert.equal(autoRun.run.previousSummaryRef, completed.summaryRef);
  assert.match(await readFile(join(root, autoRun.run.sessionRef), "utf8"), /previousSummaryRef/);
});

test("complete task persists final text in visible task chat", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-complete-chat-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-visible-create",
    input: { title: "Responder direto", column: "inbox", projectTargets: [] }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-visible-running",
    taskId: created.task.id,
    patch: {
      status: "running",
      column: "generalist",
      routing: { ...created.task.routing, currentAgent: "generalist", currentRole: "generalist" },
      agent: { currentRunId: "run-visible" }
    }
  }, root);
  await handleCommand({
    type: "agent.complete_task",
    commandId: "cmd-visible-complete",
    taskId: created.task.id,
    runId: "run-visible",
    nextColumn: "done",
    summary: "Resumo curto.",
    finalText: "Resposta final completa para o usuário."
  }, root);
  const comments = await readTaskComments(root, { taskId: created.task.id });
  assert.equal(comments.some((message) => message.text === "Resposta final completa para o usuário."), true);
});

test("task run sends Pi prompt and persists prompt-sent evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-prompt-sent-"));
  const modulePath = join(root, "mock-pi-sdk.mjs");
  await writeFile(modulePath, `
    export const VERSION = "0.79.1";
    export const SessionManager = { create: () => ({ getSessionId: () => "mock-session", getSessionFile: () => "mock-session.jsonl" }) };
    export const defineTool = (tool) => tool;
    export async function createAgentSession({ customTools }) {
      const subscribers = [];
      return {
        session: {
          sessionId: "mock-session",
          sessionFile: "mock-session.jsonl",
          setSessionName() {},
          getActiveToolNames() { return (customTools || []).map((tool) => tool.name); },
          subscribe(callback) { subscribers.push(callback); return () => {}; },
          async prompt(text) {
            if (!String(text).includes("Recent Task Chat")) throw new Error("missing recent chat in prompt");
            if (!String(text).includes("Use run_command before completion.")) throw new Error("missing task chat message in prompt");
            subscribers.forEach((callback) => callback({ type: "message", message: { role: "assistant", content: "ok" } }));
            subscribers.forEach((callback) => callback({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-list", name: "subagent", arguments: { description: "List project files" } }] } }));
            subscribers.forEach((callback) => callback({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-list", name: "subagent", arguments: { description: "List project files" } }] } }));
          },
          dispose() {}
        },
        modelFallbackMessage: null
      };
    }
  `);
  const previousPackage = process.env.KCA_PI_SDK_PACKAGE;
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  process.env.KCA_PI_SDK_PACKAGE = modulePath;
  delete process.env.KCA_PI_ADAPTER;
  try {
    const created = await handleCommand({
      type: "task.create",
      commandId: "cmd-prompt-sent-create",
      input: { title: "Prompt sent", column: "engineering", projectTargets: [], routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
    }, root);
    await handleCommand({
      type: "agent.message",
      commandId: "cmd-prompt-sent-context",
      message: { scope: "task", taskId: created.task.id, persona: "engineering", agentId: "engineering", text: "Use run_command before completion." }
    }, root);
    const started = await handleCommand({
      type: "task.run",
      commandId: "cmd-prompt-sent-run",
      taskId: created.task.id,
      agentId: "engineering"
    }, root);
    assert.equal(started.task.status, "running");
    assert.equal(started.run.adapter.promptSent, true);
    const session = await readFile(join(root, started.run.sessionRef), "utf8");
    assert.match(session, /agent.prompt_sent/);
    assert.match(session, /agent.transcript/);
    assert.match(session, /"text":"ok"/);
    assert.match(session, /complete_task/);
    assert.equal(started.run.adapter.activeTools.includes("run_command"), true);
    assert.equal(started.run.adapter.activeTools.includes("deploy_task"), false);
    assert.equal(started.run.adapter.activeTools.includes("review_task"), false);
    assert.equal(started.run.adapter.activeTools.includes("spawn_subtasks"), false);
    const logs = await handleQuery({ type: "agent.logs", taskId: created.task.id, limit: 20 }, root);
    assert.equal(logs.items.some((item) => item.type === "agent.transcript" && item.text === "ok"), true);
    assert.equal(logs.items.filter((item) => item.type === "agent.transcript" && item.category === "tool_call" && item.text.includes("subagent")).length, 1);
  } finally {
    if (previousPackage === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
    else process.env.KCA_PI_SDK_PACKAGE = previousPackage;
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
  }
});

test("run_command records command evidence without changing task status", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-run-command-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-run-command-create",
    input: { title: "Run command", column: "engineering", status: "running", routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-run-command-active",
    taskId: created.task.id,
    patch: { agent: { currentRunId: "run-command", currentSessionRef: "session.jsonl", resumeMode: "continue" } }
  }, root);
  const result = await handleCommand({
    type: "agent.run_command",
    commandId: "cmd-run-command",
    taskId: created.task.id,
    runId: "run-command",
    command: process.execPath,
    args: ["-e", "console.log('validated')"]
  }, root);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /validated/);
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.status, "running");
  const events = (await handleQuery({ type: "task.files", taskId: created.task.id }, root)).events;
  assert.equal(events.some((event) => event.type === "agent.command" && event.exitCode === 0), true);
  await assert.rejects(handleCommand({
    type: "agent.run_command",
    commandId: "cmd-run-command-escape",
    taskId: created.task.id,
    runId: "run-command",
    command: process.execPath,
    cwd: "..",
    args: ["-e", "console.log('outside')"]
  }, root), /cwd_outside_task_workspace/);
});

test("report_blocker writes one visible manager comment for repeated blocker text", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-blocker-dedupe-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-blocker-dedupe-create",
    input: { title: "Blocker dedupe", column: "engineering", status: "running", routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-blocker-dedupe-active",
    taskId: created.task.id,
    patch: { agent: { currentRunId: "run-blocker", currentSessionRef: "session.jsonl", resumeMode: "continue" } }
  }, root);
  const blocker = "Subagent tool unavailable; use run_command instead.";
  await handleCommand({ type: "agent.report_blocker", commandId: "cmd-blocker-dedupe-a", taskId: created.task.id, runId: "run-blocker", blocker }, root);
  const comments = await handleQuery({ type: "task.comments", taskId: created.task.id }, root);
  assert.equal(comments.filter((message) => message.text === blocker).length, 1);
});

test("task run preserves terminal tool state produced during prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-prompt-tool-terminal-"));
  const modulePath = join(root, "tool-calling-pi-sdk.mjs");
  await writeFile(modulePath, `
    export const VERSION = "0.79.1";
    export const SessionManager = { create: () => ({ getSessionId: () => "tool-session", getSessionFile: () => "tool-session.jsonl" }) };
    export const defineTool = (tool) => tool;
    export async function createAgentSession({ customTools }) {
      return {
        session: {
          sessionId: "tool-session",
          sessionFile: "tool-session.jsonl",
          setSessionName() {},
          getActiveToolNames() { return (customTools || []).map((tool) => tool.name); },
          subscribe() { return () => {}; },
          async prompt(_text, options) {
            options?.preflightResult?.(true);
            await customTools.find((tool) => tool.name === "complete_task").execute("call-complete", { nextColumn: "done", summary: "Concluido pelo prompt." });
          },
          dispose() {}
        },
        modelFallbackMessage: null
      };
    }
  `);
  const previousPackage = process.env.KCA_PI_SDK_PACKAGE;
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  process.env.KCA_PI_SDK_PACKAGE = modulePath;
  delete process.env.KCA_PI_ADAPTER;
  try {
    const created = await handleCommand({
      type: "task.create",
      commandId: "cmd-prompt-tool-create",
      input: { title: "Prompt tool terminal", column: "inbox", projectTargets: [] }
    }, root);
    const run = await handleCommand({
      type: "task.run",
      commandId: "cmd-prompt-tool-run",
      taskId: created.task.id,
      agentId: "engineering"
    }, root);
    assert.equal(run.ok, true);
    assert.equal(run.task.status, "done");
    assert.equal(run.task.column, "done");
    const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
    assert.equal(detail.status, "done");
    const events = (await handleQuery({ type: "task.files", taskId: created.task.id }, root)).events;
    assert.equal(events.some((event) => event.type === "agent.tool_call" && event.tool === "complete_task"), true);
    assert.equal(events.some((event) => event.type === "agent.run_recorded"), true);
  } finally {
    if (previousPackage === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
    else process.env.KCA_PI_SDK_PACKAGE = previousPackage;
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
  }
});

test("all default agents load editable prompts and can start sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-agents-"));
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-agent-capacity",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 20, agentTokens: { assistant: 2, manager: 2, product: 2, design: 2, architecture: 2, generalist: 2, engineering: 2, quality: 2, review: 2, deployment: 2, "hook-agent": 2 }, projectTokens: { "kanban-code-agent": 20 } } }
  }, root);
  const agents = ["assistant", "manager", "product", "design", "architecture", "generalist", "engineering", "quality", "review", "deployment", "hook-agent"];
  const settingsAgents = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  for (const legacy of ["architect", "engineer", "validator", "reviewer"]) {
    assert.equal(settingsAgents.agents.some((agent) => agent.id === legacy), false);
  }
  for (const agentId of agents) {
    const created = await handleCommand({
      type: "task.create",
      commandId: `cmd-agent-${agentId}`,
      input: { title: `Agent ${agentId}`, column: "inbox", projectTargets: ["kanban-code-agent"] }
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
  const reset = await handleCommand({
    type: "chat.reset_board",
    commandId: "cmd-agent-chat-reset",
    agentId: "assistant"
  }, root);
  assert.equal(reset.chat.messageCount, 2);
  assert.equal((await handleQuery({ type: "chat.history", scope: "board" }, root)).length, 0);
});

test("assistant chat creates tasks from recent context and defaults to manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-chat-context-create-"));
  const unclear = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-unclear-create",
    scope: "board",
    agentId: "assistant",
    prompt: "crie uma task para buscar essa informação"
  }, root);
  assert.equal(unclear.action, null);
  assert.match(unclear.reply, /Qual informação/);

  await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-context",
    scope: "board",
    agentId: "assistant",
    prompt: "nome do pais e temperatura."
  }, root);
  const created = await handleCommand({
    type: "agent.chat",
    commandId: "cmd-agent-chat-context-create",
    scope: "board",
    agentId: "assistant",
    prompt: "eu quero que vc crie uma task"
  }, root);
  assert.equal(created.action.type, "task.created");
  assert.equal(created.action.column, "manager");
  const snapshot = await handleQuery({ type: "board.snapshot" }, root);
  const task = snapshot.tasks.find((item) => item.id === created.action.taskId);
  assert.equal(task.title, "nome do pais e temperatura");
  assert.equal(task.column, "manager");
});

test("assistant chat can move and rename the selected task", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-chat-move-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-agent-chat-selected-create",
    input: { title: "Selecionada", column: "inbox", projectTargets: ["kanban-code-agent"] }
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
  assert.equal(moved.action.column, "engineering");

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
    input: { title: "Task scoped assistant", column: "inbox", projectTargets: ["kanban-code-agent"] }
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

test("task comments answer agent input and auto resume requester role", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-comments-resume-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-comments-create",
    input: {
      title: "Needs human answer",
      column: "inbox",
      status: "idle",
      routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } }
    }
  }, root);
  const input = await handleCommand({
    type: "agent.wait_for_human",
    commandId: "cmd-comments-input",
    taskId: created.task.id,
    requestedByRole: "engineering",
    question: "Qual branch alvo?"
  }, root);
  assert.equal(input.task.status, "idle");
  assert.equal(input.task.column, "human_wait");

  const commentsAfterQuestion = await handleQuery({ type: "task.comments", taskId: created.task.id }, root);
  assert.equal(commentsAfterQuestion.some((message) => message.text === "Qual branch alvo?" && message.role === "assistant"), true);

  await handleCommand({
    type: "settings.update",
    commandId: "cmd-comments-runtime",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 0 } }
  }, root);
  const answer = await handleCommand({
    type: "task.comment",
    commandId: "cmd-comments-answer",
    taskId: created.task.id,
    text: "Use main."
  }, root);
  assert.equal(answer.resumed, true);

  const commentsAfterAnswer = await handleQuery({ type: "task.comments", taskId: created.task.id }, root);
  const humanAnswer = commentsAfterAnswer.find((message) => message.text === "Use main." && message.role === "user");
  assert.equal(humanAnswer?.displayPersona, "human");
  assert.equal(humanAnswer?.persona, "engineering");
  assert.equal(answer.task.column, "engineering");
  assert.equal(answer.task.status, "queued");
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.column, "engineering");
  assert.equal(detail.status, "queued");

  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(files.events.some((item) => item.type === "task.comment" || item.type === "human.input_received"), true);
  const firstLogs = await handleQuery({ type: "agent.logs", taskId: created.task.id, limit: 2 }, root);
  assert.equal(firstLogs.items.length <= 2, true);
  if (firstLogs.nextCursor) {
    const olderLogs = await handleQuery({ type: "agent.logs", taskId: created.task.id, limit: 2, cursor: firstLogs.nextCursor }, root);
    assert.equal(olderLogs.items.length <= 2, true);
  }
});

test("task comments during a running agent requeue the same agent after completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-comments-deferred-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-comments-deferred-create",
    input: { title: "Deferred comment", column: "inbox", projectTargets: [] }
  }, root);
  const started = await handleCommand({
    type: "task.run",
    commandId: "cmd-comments-deferred-run",
    taskId: created.task.id,
    agentId: "engineering"
  }, root);
  const comment = await handleCommand({
    type: "task.comment",
    commandId: "cmd-comments-deferred-comment",
    taskId: created.task.id,
    text: "Considere este detalhe antes de finalizar."
  }, root);
  assert.equal(comment.deferred, true);
  const completed = await handleCommand({
    type: "agent.complete_task",
    commandId: "cmd-comments-deferred-complete",
    taskId: created.task.id,
    runId: started.run.runId,
    nextColumn: "done",
    summary: "Tentaria finalizar."
  }, root);
  assert.equal(completed.task.status, "queued");
  assert.equal(completed.task.routing.currentAgent, "engineering");
  assert.deepEqual(completed.scheduler.started.map((item) => item.taskId), [created.task.id]);
  const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
  assert.equal(detail.status, "running");
  assert.equal(detail.routing.currentAgent, "engineering");
  const comments = await handleQuery({ type: "task.comments", taskId: created.task.id }, root);
  assert.equal(comments.some((message) => message.text === "Considere este detalhe antes de finalizar."), true);
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
    agentId: "engineering"
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

test("mutating agent tools reject stale run ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-stale-tool-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-stale-tool-create",
    input: { title: "Stale tool", column: "engineering", status: "running", routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-stale-tool-active",
    taskId: created.task.id,
    patch: { agent: { currentRunId: "run-current", currentSessionRef: "session.jsonl", resumeMode: "continue" } }
  }, root);
  await assert.rejects(
    () => handleCommand({
      type: "agent.emit_artifact",
      commandId: "cmd-stale-tool-emit",
      taskId: created.task.id,
      runId: "run-old",
      path: "stale.md",
      content: "stale"
    }, root),
    /run_mismatch/
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
    agentId: "engineering"
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
  assert.equal(merge.task.status, "queued");
  assert.equal(merge.task.column, "manager");
  assert.equal((await handleQuery({ type: "task.comments", taskId: created.task.id }, root)).some((message) => message.persona === "manager"), true);
});

test("task run blocks configured projects without repoPath", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-missing-repo-"));
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-missing-repo-settings",
    scope: "projects",
    patch: { id: "missing-repo", label: "Missing repo" }
  }, root);
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-missing-repo-create",
    input: { title: "Needs repo", column: "inbox", projectTargets: ["missing-repo"] }
  }, root);
  const run = await handleCommand({
    type: "task.run",
    commandId: "cmd-missing-repo-run",
    taskId: created.task.id,
    agentId: "engineering"
  }, root);
  assert.equal(run.ok, false);
  assert.equal(run.task.status, "queued");
  assert.equal(run.task.column, "manager");
  assert.match(run.why.reasons.join(" "), /repoPath/);
  assert.equal((await handleQuery({ type: "task.comments", taskId: created.task.id }, root)).some((message) => /repoPath/.test(message.text)), true);
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
  assert.equal(blocked.task.status, "queued");
  assert.equal(blocked.task.column, "manager");
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
    agentId: "engineering"
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
      { title: "Implementar runtime", needs: [], provides: ["runtime:agent"], fileLocks: ["packages/agent-runtime/**"], role: "engineering" },
      { title: "Validar runtime", needs: ["runtime:agent"], provides: ["runtime:validated"], fileLocks: ["tests/**"], agentId: "validator" }
    ]
  }, root);
  assert.equal(decomposed.subtasks.length, 2);
  assert.equal(decomposed.subtasks[0].kind, "subtask");
  assert.equal(decomposed.subtasks[0].routing.currentRole, "engineering");
  assert.equal(decomposed.subtasks[1].routing.currentRole, "quality");
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

test("planning service creates planning and acceptance artifacts for a master task", () => {
  const artifacts = planningArtifactsForTask({ id: "KCA-PLAN", title: "Master ready" });
  assert.equal(artifacts.planning.taskId, "KCA-PLAN");
  assert.equal(artifacts.planning.roles.required.includes("architecture"), true);
  assert.equal(artifacts.planning.roles.required.includes("deployment"), true);
  assert.match(artifacts.acceptance, /Master ready funciona de ponta a ponta/);
});

test("orchestrator decomposes a master task into N subtasks with DAG edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-dag-"));
  const parent = await handleCommand({
    type: "task.create",
    commandId: "cmd-dag-parent",
    input: { title: "Master DAG", kind: "master", projectTargets: ["kanban-code-agent"] }
  }, root);
  const subtasks = Array.from({ length: 6 }, (_, index) => ({
    title: `Subtask ${index + 1}`,
    needs: index === 0 ? [] : [`contract:${index}`],
    provides: [`contract:${index + 1}`],
    fileLocks: index < 2 ? ["packages/core/**"] : [],
    agentId: "engineering"
  }));
  const result = await handleCommand({ type: "task.decompose", commandId: "cmd-dag-decompose", taskId: parent.task.id, subtasks }, root);
  assert.equal(result.subtasks.length, 6);
  const subtasksFile = YAML.parse(await readFile(join(root, "tasks", parent.task.id, "subtasks.yaml"), "utf8"));
  assert.equal(subtasksFile.nodes.length, 6);
  assert.equal(subtasksFile.edges.length, 5);
});

test("orchestrator rejects invalid DAG decomposition with manager triage", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-dag-invalid-"));
  const parent = await handleCommand({
    type: "task.create",
    commandId: "cmd-dag-invalid-parent",
    input: { title: "Invalid DAG", kind: "master", projectTargets: ["kanban-code-agent"] }
  }, root);
  const result = await handleCommand({
    type: "task.decompose",
    commandId: "cmd-dag-invalid-decompose",
    taskId: parent.task.id,
    subtasks: [
      { id: `${parent.task.id}-a`, title: "A", needs: ["b"], provides: ["a"], agentId: "engineering" },
      { id: `${parent.task.id}-b`, title: "B", needs: ["a"], provides: ["b"], agentId: "engineering" }
    ]
  }, root);
  assert.equal(result.ok, false);
  assert.equal(result.task.status, "queued");
  assert.equal(result.task.column, "manager");
  assert.equal(result.errors.some((error) => error.type === "cycle"), true);
  const files = await handleQuery({ type: "task.files", taskId: parent.task.id }, root);
  assert.equal(files.events.some((event) => event.type === "task.decompose.failed"), true);
  assert.equal((await handleQuery({ type: "task.comments", taskId: parent.task.id }, root)).some((message) => /Invalid subtask DAG/.test(message.text)), true);
});

test("scheduler explains global limits, agent/project tokens and semaphores", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-orch-"));
  await handleCommand({ type: "settings.update", commandId: "cmd-settings-limits", scope: "app", patch: { runtime: { maxParallelTasks: 1, agentTokens: { engineering: 1 }, projectTokens: { "kanban-code-agent": 1 } } } }, root);
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
    patch: { status: "running", routing: { ...running.task.routing, currentAgent: "engineering" }, dependencies: { ...running.task.dependencies, semaphores: [{ name: "global:merge", tokens: 1 }] } }
  }, root);
  await handleCommand({
    type: "task.update",
    commandId: "cmd-queued-limit-update",
    taskId: queued.task.id,
    patch: { status: "queued", routing: { ...queued.task.routing, currentAgent: "engineering" }, dependencies: { ...queued.task.dependencies, semaphores: [{ name: "global:merge", tokens: 1 }] } }
  }, root);
  const why = await handleQuery({ type: "why_not_running", taskId: queued.task.id }, root);
  assert.match(why.reasons.join(" "), /Limite global/);
  assert.match(why.reasons.join(" "), /Tokens do agent engineering/);
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
  assert.equal(columns.columns.length, 12);

  const agentUpdate = await handleCommand({
    type: "settings.update",
    commandId: "cmd-agent-settings",
    scope: "agents",
    patch: { id: "engineering", limits: { tokens: 3 }, skills: ["implementation", "testing"] }
  }, root);
  assert.equal(agentUpdate.settings.limits.tokens, 3);
  assert.match(await readFile(join(root, "settings", "agents", "engineering.yaml"), "utf8"), /tokens: 3/);

  const agents = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  assert.equal(agents.agents.some((agent) => agent.id === "engineering" && agent.limits.tokens === 3), true);

  const boardUpdate = await handleCommand({
    type: "settings.update",
    commandId: "cmd-board-settings",
    scope: "columns",
    patch: { columns: [{ id: "inbox", label: "Entrada", wip: 1, wipLimit: 1 }] }
  }, root);
  assert.equal(boardUpdate.settings.columns[0].wipLimit, 1);
  assert.match(await readFile(join(root, "settings", "boards", "default.yaml"), "utf8"), /wipLimit: 1/);
});

test("current role prompts include benchmark-required sections", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-prompt-sections-"));
  const settings = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  const requiredRoles = ["manager", "product", "design", "architecture", "generalist", "engineering", "quality", "review", "deployment"];
  const sections = ["Mission:", "Inputs:", "Allowed tools:", "Decision ladder:", "Evidence:", "Handoff:", "Stop conditions:", "Forbidden actions:"];
  for (const role of requiredRoles) {
    const prompt = settings.agents.find((agent) => agent.id === role)?.instructionsBody || "";
    for (const section of sections) assert.match(prompt, new RegExp(section.replace(":", ":")), `${role} missing ${section}`);
  }
  const managerPrompt = settings.agents.find((agent) => agent.id === "manager")?.instructionsBody || "";
  assert.match(managerPrompt, /Modes:/);
  for (const mode of ["intake", "contract_review", "execution_planning", "progress_control"]) assert.match(managerPrompt, new RegExp(mode));
  assert.equal(settings.agents.some((agent) => agent.id === "project_manager"), false);
});

test("manager prompt classifies direct research for generalist handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-manager-routing-"));
  const task = {
    id: "KCA-MANAGER-ROUTING",
    title: "Pesquisar e listar os 10 paises com as temperaturas mais baixas registradas hoje.",
    column: "manager",
    status: "queued",
    projectTargets: [],
    routing: { currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } },
    dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    worktree: { enabled: false },
    skills: { active: [] }
  };
  await mkdir(join(root, "tasks", task.id), { recursive: true });
  await writeFile(join(root, "tasks", task.id, "description.md"), `# ${task.title}\n`);
  await writeFile(join(root, "tasks", task.id, "acceptance.md"), "- [ ] Lista entregue.\n");
  await writeFile(join(root, "tasks", task.id, "planning.yaml"), "status: draft\n");
  const chat = await buildAgentChat(task, root, { persona: "manager", agentId: "manager" });
  assert.equal(chat.managerRouting.classification, "direct_operational");
  assert.equal(chat.managerRouting.managerMode, "execution_planning");
  assert.equal(chat.managerRouting.targetRole, "generalist");
  assert.match(chat.system.content, /manager_mode: execution_planning/);
  assert.match(chat.system.content, /Direct research\/listing\/formatting work with concrete acceptance should go to generalist/);
  assert.equal(chat.tools.some((tool) => tool.name === "wait_for_persona"), true);
  assert.equal(chat.tools.some((tool) => tool.name === "delegate_task"), true);
});

test("manager prompt routes direct research with placeholder acceptance to generalist fast path", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-manager-placeholder-routing-"));
  const task = {
    id: "KCA-MANAGER-PLACEHOLDER",
    title: "Pesquisar e listar os 10 paises com as temperaturas mais baixas registradas hoje.",
    column: "manager",
    status: "queued",
    projectTargets: [],
    routing: { currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } },
    dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    worktree: { enabled: false },
    skills: { active: [] }
  };
  await mkdir(join(root, "tasks", task.id), { recursive: true });
  await writeFile(join(root, "tasks", task.id, "description.md"), `# ${task.title}\n`);
  await writeFile(join(root, "tasks", task.id, "acceptance.md"), "# Critérios de aceite\n\n- [ ] Critério verificável de pronto.\n");
  await writeFile(join(root, "tasks", task.id, "planning.yaml"), "status: draft\n");
  const chat = await buildAgentChat(task, root, { persona: "manager", agentId: "manager" });
  assert.equal(chat.managerRouting.classification, "direct_operational");
  assert.equal(chat.managerRouting.managerMode, "execution_planning");
  assert.equal(chat.managerRouting.targetRole, "generalist");
  assert.equal(chat.managerRouting.direct, true);
  assert.match(chat.system.content, /complete to done with concise source\/date evidence/);
  assert.match(chat.system.content, /no more than two live-data command attempts/);
});

test("manager prompt still routes unclear placeholder acceptance to product", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-manager-product-placeholder-"));
  const task = {
    id: "KCA-MANAGER-PRODUCT",
    title: "Definir requisitos e critérios de aceite para novo fluxo de onboarding.",
    column: "manager",
    status: "queued",
    projectTargets: [],
    routing: { currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } },
    dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    worktree: { enabled: false },
    skills: { active: [] }
  };
  await mkdir(join(root, "tasks", task.id), { recursive: true });
  await writeFile(join(root, "tasks", task.id, "description.md"), `# ${task.title}\n`);
  await writeFile(join(root, "tasks", task.id, "acceptance.md"), "# Critérios de aceite\n\n- [ ] Critério verificável de pronto.\n");
  await writeFile(join(root, "tasks", task.id, "planning.yaml"), "status: draft\n");
  const chat = await buildAgentChat(task, root, { persona: "manager", agentId: "manager" });
  assert.equal(chat.managerRouting.classification, "contract_missing");
  assert.equal(chat.managerRouting.managerMode, "intake");
  assert.equal(chat.managerRouting.targetRole, "product");
  assert.match(chat.system.content, /Acceptance is missing or placeholder/);
});

test("manager product and generalist prompts persist fast research contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-fast-research-prompts-"));
  const settings = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  const managerPrompt = settings.agents.find((agent) => agent.id === "manager")?.instructionsBody || "";
  const productPrompt = settings.agents.find((agent) => agent.id === "product")?.instructionsBody || "";
  const generalistPrompt = settings.agents.find((agent) => agent.id === "generalist")?.instructionsBody || "";
  const generalist = settings.agents.find((agent) => agent.id === "generalist");
  assert.match(managerPrompt, /routes to generalist -> done even when acceptance\.md is still the generated placeholder/);
  assert.match(managerPrompt, /use report_blocker or request_user_input instead of continuing with estimates/);
  assert.match(productPrompt, /emit_artifact with path "acceptance.md"/);
  assert.match(productPrompt, /acceptance\.md is no longer placeholder/);
  assert.match(productPrompt, /direct operational research\/listing goes to generalist/);
  assert.match(generalistPrompt, /complete_task with nextColumn "done"/);
  assert.match(generalistPrompt, /run_command/);
  assert.match(generalistPrompt, /command "sh" with args \["-lc", "\.\.\."\]/);
  assert.match(generalistPrompt, /do not retry the same live source more than twice/);
  assert.match(generalistPrompt, /source\/date assumptions/);
  assert.equal(generalist.tools.includes("run_command"), true);
});

test("storage init amends existing manager product and generalist prompts", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-prompt-amend-"));
  await mkdir(join(root, "settings", "agents"), { recursive: true });
  await mkdir(join(root, "settings", "prompts"), { recursive: true });
  await writeFile(join(root, "settings", "agents", "generalist.yaml"), YAML.stringify({
    schema: "kanban-code-agent/agent@1",
    id: "generalist",
    label: "Generalist",
    instructionsPath: "../prompts/generalist.md",
    tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"]
  }));
  await writeFile(join(root, "settings", "prompts", "manager.md"), "# Manager\n\nDecision ladder: if acceptance is missing or placeholder, use intake and route to product.\n");
  await writeFile(join(root, "settings", "prompts", "product.md"), "# Product\n\nRequired output: explicit acceptance criteria and next responsible persona.\n");
  await writeFile(join(root, "settings", "prompts", "generalist.md"), "# Generalist\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact.\n");
  await initStorage(root);
  const agents = await handleQuery({ type: "settings.scope", scope: "agents" }, root);
  const generalist = agents.agents.find((agent) => agent.id === "generalist");
  assert.equal(generalist.tools.includes("run_command"), true);
  assert.match(await readFile(join(root, "settings", "prompts", "manager.md"), "utf8"), /instead of continuing with estimates/);
  assert.match(await readFile(join(root, "settings", "prompts", "product.md"), "utf8"), /acceptance\.md is no longer placeholder/);
  assert.match(await readFile(join(root, "settings", "prompts", "product.md"), "utf8"), /direct operational research\/listing goes to generalist/);
  assert.match(await readFile(join(root, "settings", "prompts", "generalist.md"), "utf8"), /command "sh" with args \["-lc", "\.\.\."\]/);
  assert.match(await readFile(join(root, "settings", "prompts", "generalist.md"), "utf8"), /do not retry the same live source more than twice/);
});

test("fast research task completes through manager to generalist under 120 seconds", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-fast-research-e2e-"));
  const modulePath = join(root, "fast-research-pi-sdk.mjs");
  await writeFile(modulePath, `
    export const VERSION = "test";
    export const SessionManager = { create: () => ({ getSessionId: () => "fast-session", getSessionFile: () => "fast-session.jsonl" }) };
    export const defineTool = (tool) => tool;
    export async function createAgentSession({ customTools }) {
      return {
        session: {
          sessionId: "fast-session",
          sessionFile: "fast-session.jsonl",
          setSessionName() {},
          getActiveToolNames() { return (customTools || []).map((tool) => tool.name); },
          subscribe() { return () => {}; },
          async prompt(text, options) {
            options?.preflightResult?.(true);
            const prompt = String(text);
            if (prompt.includes("Persona: manager")) {
              if (!prompt.includes("direct_task: yes")) throw new Error("manager missing direct fast path context");
              await customTools.find((tool) => tool.name === "wait_for_persona").execute("call-manager-generalist", {
                targetRole: "generalist",
                question: "Pesquisar e entregar top 10 com fonte/data, completando em done."
              });
              return;
            }
            if (prompt.includes("Persona: generalist")) {
              if (!prompt.includes("run_command")) throw new Error("generalist missing run_command");
              await customTools.find((tool) => tool.name === "run_command").execute("call-generalist-command", {
                command: process.execPath,
                args: ["-e", "console.log('source=fake-weather date=2026-06-13 rows=10')"],
                timeoutMs: 120000
              });
              await customTools.find((tool) => tool.name === "emit_artifact").execute("call-generalist-artifact", {
                path: "top10-paises-frios.md",
                content: [
                  "# Top 10 paises com menores temperaturas hoje",
                  "",
                  "Fonte: fake-weather, 2026-06-13.",
                  "",
                  "1. Canada - -12 C",
                  "2. Russia - -11 C",
                  "3. Greenland - -9 C",
                  "4. Norway - -5 C",
                  "5. Finland - -3 C",
                  "6. Sweden - -2 C",
                  "7. Iceland - 0 C",
                  "8. Chile - 1 C",
                  "9. Argentina - 2 C",
                  "10. Mongolia - 3 C",
                  ""
                ].join(String.fromCharCode(10))
              });
              await customTools.find((tool) => tool.name === "complete_task").execute("call-generalist-complete", {
                nextColumn: "done",
                summary: "Top 10 entregue com fonte fake-weather e data 2026-06-13."
              });
              return;
            }
            throw new Error("unexpected persona prompt");
          },
          dispose() {}
        },
        modelFallbackMessage: null
      };
    }
  `);
  const previousPackage = process.env.KCA_PI_SDK_PACKAGE;
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  process.env.KCA_PI_SDK_PACKAGE = modulePath;
  delete process.env.KCA_PI_ADAPTER;
  try {
    const startedAt = Date.now();
    const created = await handleCommand({
      type: "task.create",
      commandId: "cmd-fast-research-create",
      input: {
        title: "pesquise e faca uma lista com top 10 paises com as menores temperaturas hoje",
        projectTargets: []
      }
    }, root);
    const elapsedMs = Date.now() - startedAt;
    const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
    const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
    const artifact = await readFile(join(root, "tasks", created.task.id, "artifacts", "top10-paises-frios.md"), "utf8");
    const promptAgents = new Set(files.events.filter((event) => event.type === "agent.prompt_sent").map((event) => event.agentId));
    assert.equal(detail.status, "done");
    assert.equal(detail.column, "done");
    assert.equal(elapsedMs < 120000, true);
    assert.equal(files.events.some((event) => event.type === "manager.routing_context" && event.classification === "direct_operational" && event.targetRole === "generalist"), true);
    assert.deepEqual([...promptAgents].sort(), ["generalist", "manager"]);
    assert.equal(files.events.some((event) => event.type === "agent.command" && event.actor === "generalist" && event.exitCode === 0), true);
    assert.equal(files.events.some((event) => event.type === "agent.tool_call" && event.actor === "generalist" && event.tool === "complete_task"), true);
    assert.match(artifact, /Fonte: fake-weather, 2026-06-13/);
    assert.equal((artifact.match(/^\d+\./gm) || []).length, 10);
  } finally {
    if (previousPackage === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
    else process.env.KCA_PI_SDK_PACKAGE = previousPackage;
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
  }
});

test("manager prompt plans concrete endpoint work through architecture before engineering", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-manager-endpoint-routing-"));
  const task = {
    id: "KCA-MANAGER-ENDPOINT",
    title: "Implementar endpoint API de relatorio com schema de resposta",
    column: "manager",
    status: "queued",
    projectTargets: [],
    routing: { currentAgent: "manager", currentRole: "manager", manualOverride: { active: false } },
    dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    worktree: { enabled: false },
    skills: { active: [] }
  };
  await mkdir(join(root, "tasks", task.id), { recursive: true });
  await writeFile(join(root, "tasks", task.id, "description.md"), `# ${task.title}\n`);
  await writeFile(join(root, "tasks", task.id, "acceptance.md"), "- [ ] Endpoint retorna schema documentado.\n");
  await writeFile(join(root, "tasks", task.id, "planning.yaml"), "status: draft\n");
  const chat = await buildAgentChat(task, root, { persona: "manager", agentId: "manager" });
  assert.equal(chat.managerRouting.classification, "technical_architecture");
  assert.equal(chat.managerRouting.managerMode, "execution_planning");
  assert.equal(chat.managerRouting.targetRole, "architecture");
  assert.equal(chat.managerRouting.order, "architecture -> engineering -> quality -> review");
});

test("init migrates existing boards with missing default manager column", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-board-migrate-"));
  const boardDir = join(root, "settings", "boards");
  await mkdir(boardDir, { recursive: true });
  await writeFile(join(boardDir, "default.yaml"), YAML.stringify({
    schema: "kanban-code-agent/board@1",
    id: "default",
    columns: [
      { id: "inbox", label: "Entrada", agent: "assistant", autoStart: false },
      { id: "product", label: "Produto", agent: "product", autoStart: true },
      { id: "done", label: "Pronto", agent: null, autoStart: false }
    ]
  }));
  const columns = await handleQuery({ type: "settings.scope", scope: "columns" }, root);
  const ids = columns.columns.map((column) => column.id);
  assert.equal(ids.includes("manager"), true);
  assert.equal(ids.indexOf("manager") < ids.indexOf("product"), true);
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

  const acceptance = await handleCommand({
    type: "agent.emit_artifact",
    commandId: "cmd-acceptance-artifact",
    taskId: created.task.id,
    path: "acceptance.md",
    content: "- [ ] Evidência contratual atualizada."
  }, root);
  assert.equal(acceptance.artifactPath, "acceptance.md");
  assert.match(await readFile(join(root, "tasks", created.task.id, "acceptance.md"), "utf8"), /Evidência contratual atualizada/);

  const input = await handleCommand({
    type: "agent.request_user_input",
    commandId: "cmd-input",
    taskId: created.task.id,
    question: "Aprovar merge?"
  }, root);
  assert.equal(input.task.status, "idle");
  assert.equal(input.task.column, "human_wait");
  assert.match(await readFile(join(root, "tasks", created.task.id, input.inputPath), "utf8"), /Aprovar merge/);
  const comments = await handleQuery({ type: "task.comments", taskId: created.task.id }, root);
  assert.equal(comments.some((message) => message.text === "Aprovar merge?"), true);
});

test("agentic workflow handoffs keep persona context and human wait distinct from persona wait", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-agentic-flow-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-agentic-create",
    input: { title: "Fluxo agentico", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "product", currentRole: "product", manualOverride: { active: false } }, column: "product", status: "queued" }
  }, root);
  const message = await handleCommand({
    type: "agent.step",
    commandId: "cmd-agentic-message",
    taskId: created.task.id,
    disposition: { type: "message_and_continue", message: { scope: "task", taskId: created.task.id, persona: "product", agentId: "product", text: "Critérios propostos.", visibility: "both" } }
  }, root);
  assert.equal(message.message.persona, "product");

  const handoff = await handleCommand({
    type: "agent.wait_for_persona",
    commandId: "cmd-agentic-handoff",
    taskId: created.task.id,
    targetRole: "generalist",
    question: "Executar coleta de evidência sem código."
  }, root);
  assert.equal(handoff.task.column, "generalist");
  assert.equal(handoff.task.status, "queued");
  assert.equal(handoff.task.routing.currentRole, "generalist");

  const delegated = await handleCommand({
    type: "agent.delegate_task",
    commandId: "cmd-agentic-delegate",
    taskId: created.task.id,
    fromPersona: "generalist",
    toPersona: "engineering",
    wait: false,
    request: "Implementar parte técnica."
  }, root);
  assert.equal(delegated.task.column, "engineering");
  assert.equal(delegated.task.routing.currentAgent, "engineering");

  const human = await handleCommand({
    type: "agent.wait_for_human",
    commandId: "cmd-agentic-human",
    taskId: created.task.id,
    question: "Aprovar risco?",
    requestedByRole: "engineering",
    options: ["Aprovar", "Cancelar"]
  }, root);
  assert.equal(human.task.column, "human_wait");
  assert.equal(human.task.status, "idle");

  const answered = await handleCommand({
    type: "task.answer_input",
    commandId: "cmd-agentic-answer",
    taskId: created.task.id,
    answer: "Aprovado",
    returnRole: "engineering"
  }, root);
  assert.equal(answered.task.column, "engineering");
  assert.equal(answered.task.status, "queued");

  const chatBuild = await handleQuery({ type: "chat.build", taskId: created.task.id, persona: "product" }, root);
  assert.equal(chatBuild.schema, "kanban-code-agent/agent-chat-build@1");
  assert.equal(chatBuild.messages[0].persona, "product");
  assert.equal(chatBuild.provider, "openai");
  assert.match(chatBuild.system.content, /All visible agent comments and responses must be organized/);
  assert.match(chatBuild.system.content, /For short final content, respond directly in chat/);

  const compacted = await handleCommand({
    type: "chat.compact",
    commandId: "cmd-agentic-compact",
    taskId: created.task.id,
    persona: "product",
    summary: "Resumo compacto do Product.",
    tokenStats: { before: 100, after: 20 }
  }, root);
  assert.equal(compacted.compaction.messageCount >= 1, true);
  assert.match(await readFile(join(root, "tasks", created.task.id, compacted.compaction.summaryRef), "utf8"), /Resumo compacto/);
  const compactedHistory = await handleQuery({ type: "chat.history", scope: "task", taskId: created.task.id, persona: "product" }, root);
  assert.equal(compactedHistory[0].disposition, "chat.compacted");

  const providers = await handleQuery({ type: "provider.discover" }, root);
  assert.equal(providers.providers.some((provider) => provider.id === "openai" && provider.requiredEnv.includes("OPENAI_API_KEY")), true);
  assert.equal(providers.providers.some((provider) => provider.id === "deepseek" && provider.requiredEnv.includes("DEEPSEEK_API_KEY")), true);
  assert.equal(providers.providers.some((provider) => provider.id === "pi"), false);

  const events = (await handleQuery({ type: "task.files", taskId: created.task.id }, root)).events;
  assert.equal(events.some((event) => event.type === "role.handoff" && event.toRole === "generalist"), true);
  assert.equal(events.some((event) => event.type === "human.input_requested"), true);
  assert.equal(events.some((event) => event.type === "delegation.requested"), true);
  assert.equal(events.some((event) => event.type === "chat.compacted"), true);
});

test("provider model settings block runs when required env is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-provider-env-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-provider-create",
    input: { title: "Provider missing env", column: "inbox", status: "queued", routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
  }, root);
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-provider-agent",
    scope: "agents",
    patch: { id: "engineering", provider: "openai_compatible", model: { provider: "openai_compatible", name: "gpt-test", effort: "high" } }
  }, root);
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-provider-app",
    scope: "app",
    patch: { ai: { enabledProviders: ["openai_compatible"] } }
  }, root);
  const why = await handleQuery({ type: "why_not_running", taskId: created.task.id }, root);
  assert.equal(why.runnable, false);
  assert.match(why.reasons.join(" "), /OPENAI_COMPATIBLE_API_KEY|OPENAI_COMPATIBLE_BASE_URL/);
});

test("provider models query normalizes context metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-provider-models-"));
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: [{ id: "openai/gpt-test", name: "GPT Test", top_provider: { context_length: 8192, max_completion_tokens: 4096 } }] })
  });
  try {
    await handleCommand({
      type: "settings.update",
      commandId: "cmd-provider-models-app",
      scope: "app",
      patch: { ai: { enabledProviders: ["openrouter"] } }
    }, root);
    const result = await handleQuery({ type: "provider.models", providerId: "openrouter" }, root);
    assert.equal(result.models[0].id, "openai/gpt-test");
    assert.equal(result.models[0].contextWindow, 8192);
    assert.equal(result.models[0].maxOutputTokens, 4096);
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});

test("task usage aggregates into board snapshot, files and logs", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-usage-"));
  const startedAt = "2026-06-14T00:00:00.000Z";
  const endedAt = "2026-06-14T00:00:12.000Z";
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-usage-create",
    input: { title: "Usage aggregate", column: "inbox", status: "idle", projectTargets: ["kanban-code-agent"], routing: { currentAgent: "engineering", currentRole: "engineering", manualOverride: { active: false } } }
  }, root);
  const cacheRefresh = await refreshOpenRouterModelCache(root, {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek/deepseek-v4-pro", name: "DeepSeek: DeepSeek V4 Pro", context_length: 1048576, top_provider: { context_length: 1048576 } }
        ]
      })
    })
  });
  assert.equal(cacheRefresh.ok, true);
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: startedAt,
    type: "agent.run",
    actor: "orchestrator",
    taskId: created.task.id,
    runId: "run-usage",
    agentId: "engineering",
    role: "engineering",
    provider: "openai",
    model: "model-a",
    effort: "medium"
  });
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: startedAt,
    type: "agent.transcript",
    actor: "engineering",
    taskId: created.task.id,
    runId: "run-usage",
    providerEventType: "agent_start"
  });
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: endedAt,
    type: "agent.usage",
    actor: "engineering",
    taskId: created.task.id,
    runId: "run-usage",
    agentId: "engineering",
    role: "engineering",
    responseId: "chatcmpl-usage",
    provider: "openai",
    model: "model-a",
    usage: { inputTokens: 500, outputTokens: 120, totalTokens: 620, cacheTokens: 80, contextWindow: 2000, contextPercent: 25 }
  });
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: endedAt,
    type: "agent.run",
    actor: "orchestrator",
    taskId: created.task.id,
    runId: "run-usage-fallback",
    agentId: "engineering",
    role: "engineering",
    provider: "openai",
    model: "model-b",
    effort: "medium"
  });
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: endedAt,
    type: "agent.usage",
    actor: "engineering",
    taskId: created.task.id,
    runId: "run-usage-fallback",
    agentId: "engineering",
    role: "engineering",
    responseId: "chatcmpl-usage-fallback",
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, cacheTokens: 0, contextWindow: 2000, contextPercent: 5 }
  });
  await appendJsonl(join(paths(root).tasks, created.task.id, "events.jsonl"), {
    ts: new Date().toISOString(),
    type: "agent.transcript",
    actor: "manager",
    taskId: created.task.id,
    runId: "run-legacy-usage",
    providerEventType: "agent_end",
    providerEvent: {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      messages: [{
        role: "assistant",
        responseId: "legacy-usage",
        usage: { input: 50, output: 10, cacheRead: 100, cacheWrite: 0, totalTokens: 160 }
      }]
    }
  });
  const snapshot = await boardSnapshot(root);
  const task = snapshot.tasks.find((item) => item.id === created.task.id);
  assert.equal(task.usage.total.totalTokens, 900);
  assert.equal(task.usage.total.inputTokens, 650);
  assert.equal(task.usage.total.durationMs, 12000);
  assert.equal(task.usage.total.contextWindow, 1048576);
  assert.equal(task.usage.total.contextPercent, 0);
  assert.equal(task.usage.byAgent[0].agentId, "engineering");
  assert.equal(task.usage.byAgent[0].durationMs, 12000);
  assert.equal(task.usage.byAgent[0].contextPercent, 6);
  assert.equal(task.usage.byAgent[1].agentId, "manager");
  assert.equal(task.usage.byAgent[1].contextWindow, 1048576);
  assert.deepEqual(task.usage.byAgent[0].models.map((model) => `${model.provider}/${model.model}:${model.totalTokens}`), ["openai/model-a:620", "openai/model-b:120"]);
  assert.equal(task.usage.byAgent[0].models[0].contextPercent, 31);
  assert.equal(task.usage.byAgent[1].models[0].contextWindow, 1048576);
  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(files.usage.total.cacheTokens, 180);
  assert.equal(files.usage.byAgent[0].models[1].model, "model-b");
  const logs = await handleQuery({ type: "agent.logs", taskId: created.task.id, limit: 10 }, root);
  assert.equal(logs.items.some((item) => item.type === "agent.usage" && item.raw.usage.totalTokens === 620), true);
});

test("task files include kind, content type and size metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-file-meta-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-file-meta-create",
    input: { title: "File metadata", column: "inbox", status: "idle", projectTargets: ["kanban-code-agent"] }
  }, root);
  const taskDir = join(paths(root).tasks, created.task.id);
  await mkdir(join(taskDir, "artifacts"), { recursive: true });
  await writeFile(join(taskDir, "artifacts", "notes.txt"), "plain text\n");
  await writeFile(join(taskDir, "artifacts", "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(taskDir, "artifacts", "archive.bin"), Buffer.from([0, 1, 2, 3]));

  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  const byPath = new Map(files.fileEntries.map((file) => [file.path, file]));
  assert.equal(byPath.get("artifacts/notes.txt").kind, "text");
  assert.match(byPath.get("artifacts/notes.txt").contentType, /text\/plain/);
  assert.equal(byPath.get("artifacts/image.png").kind, "image");
  assert.equal(byPath.get("artifacts/image.png").contentType, "image/png");
  assert.equal(byPath.get("artifacts/archive.bin").kind, "binary");
  assert.equal(byPath.get("artifacts/archive.bin").size, 4);
});

test("real Pi orchestrator prompt smoke runs one task through multiple personas", { skip: realOrchestratorPromptSmokeEnabled ? false : "set KCA_PI_ORCH_PROMPT_SMOKE=1 to run real orchestrator prompt smoke" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-real-orch-smoke-"));
  const route = [
    ["product", "design"],
    ["design", "generalist"],
    ["generalist", "engineering"],
    ["engineering", "quality"],
    ["quality", "review"],
    ["review", "done"]
  ];
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  delete process.env.KCA_PI_ADAPTER;
  try {
    await handleCommand({
      type: "settings.update",
      commandId: "cmd-real-smoke-capacity",
      scope: "app",
      patch: { runtime: { maxParallelTasks: 1, agentTokens: { product: 1, design: 1, generalist: 1, engineering: 1, quality: 1, review: 1 } } }
    }, root);
    for (const [role, nextColumn] of route) {
      await handleCommand({
        type: "settings.update",
        commandId: `cmd-real-smoke-agent-${role}`,
        scope: "agents",
        patch: {
          id: role,
          provider: "pi",
          model: { provider: "pi", name: "default", effort: "low" },
          instructionsBody: `# ${role}\n\nFor this validation smoke, immediately call complete_task with nextColumn "${nextColumn}" and summary "${role} real smoke". Do not call any other tool.`
        }
      }, root);
    }
    const created = await handleCommand({
      type: "task.create",
      commandId: "cmd-real-smoke-create-chain",
      input: {
        title: "Real Pi chained agentic smoke",
        status: "queued",
        routing: { currentAgent: "product", currentRole: "product", manualOverride: { active: false } },
        projectTargets: []
      }
    }, root);
    const run = await handleCommand({
      type: "task.run",
      commandId: "cmd-real-smoke-run-chain",
      taskId: created.task.id,
      agentId: "product"
    }, root);
    assert.equal(run.ok, true);
    const detail = await handleQuery({ type: "task.detail", taskId: created.task.id }, root);
    assert.equal(detail.status, "done");
    assert.equal(detail.column, "done");
    const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
    const promptRoles = new Set(files.events.filter((event) => event.type === "agent.prompt_sent").map((event) => event.agentId));
    const toolRoles = new Set(files.events.filter((event) => event.type === "agent.tool_call" && event.tool === "complete_task").map((event) => event.actor));
    for (const [role] of route) {
      assert.equal(promptRoles.has(role), true);
      assert.equal(toolRoles.has(role), true);
    }
    assert.equal(files.events.filter((event) => event.type === "agent.tool_result" && event.tool === "complete_task" && event.ok === true).length >= route.length, true);
  } finally {
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
  }
});

test("runtime auto-compacts active persona chat before a run", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-auto-compact-"));
  await handleCommand({
    type: "settings.update",
    commandId: "cmd-auto-compact-settings",
    scope: "app",
    patch: { runtime: { maxParallelTasks: 10, chatCompaction: { maxActiveMessages: 1 }, agentTokens: { product: 2 } } }
  }, root);
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-auto-compact-create",
    input: { title: "Auto compact", column: "product", status: "queued", routing: { currentAgent: "product", currentRole: "product", manualOverride: { active: false } } }
  }, root);
  await handleCommand({ type: "agent.message", commandId: "cmd-auto-compact-msg-a", message: { scope: "task", taskId: created.task.id, persona: "product", agentId: "product", text: "Mensagem A" } }, root);
  await handleCommand({ type: "agent.message", commandId: "cmd-auto-compact-msg-b", message: { scope: "task", taskId: created.task.id, persona: "product", agentId: "product", text: "Mensagem B" } }, root);
  const run = await handleCommand({ type: "task.run", commandId: "cmd-auto-compact-run", taskId: created.task.id, agentId: "product" }, root);
  assert.equal(run.ok, true);
  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(files.events.some((event) => event.type === "chat.compacted"), true);
});

test("review and deployment commands move gates with persisted evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-review-deploy-"));
  const created = await handleCommand({
    type: "task.create",
    commandId: "cmd-review-deploy-create",
    input: { title: "Review deploy", status: "queued", column: "review", routing: { currentAgent: "review", currentRole: "review", manualOverride: { active: false } } }
  }, root);
  const failed = await handleCommand({
    type: "agent.review_task",
    commandId: "cmd-review-fail",
    taskId: created.task.id,
    findings: [{ severity: "critical", message: "regression" }],
    evidence: ["unit"]
  }, root);
  assert.equal(failed.ok, false);
  assert.equal(failed.task.column, "engineering");

  await handleCommand({
    type: "role.route_task",
    commandId: "cmd-review-route",
    taskId: created.task.id,
    role: "review",
    reason: "ready"
  }, root);
  const passed = await handleCommand({
    type: "agent.review_task",
    commandId: "cmd-review-pass",
    taskId: created.task.id,
    findings: [],
    evidence: ["lint pass"]
  }, root);
  assert.equal(passed.ok, true);
  assert.equal(passed.task.column, "deployment");

  const deployed = await handleCommand({
    type: "agent.deploy_task",
    commandId: "cmd-deploy-pass",
    taskId: created.task.id,
    command: process.execPath,
    args: ["-e", "process.stdout.write('released')"],
    cwd: root,
    rollback: "none"
  }, root);
  assert.equal(deployed.task.column, "done");
  assert.equal(deployed.deployment.status, "released");
  const files = await handleQuery({ type: "task.files", taskId: created.task.id }, root);
  assert.equal(files.events.some((event) => event.type === "gate.failed"), true);
  assert.equal(files.events.some((event) => event.type === "gate.passed"), true);
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
