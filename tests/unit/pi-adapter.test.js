import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKanbanTools, buildTaskAgentTools, doctorPi, loadPiSdk, runBoardAssistant, startPiSession } from "../../packages/pi-adapter/src/index.js";

const realPiEnabled = process.env.KCA_PI_REAL_TESTS === "1";
const realPromptSmokeEnabled = process.env.KCA_PI_PROMPT_SMOKE === "1";

test("pi adapter falls back to fake mode when SDK package is unavailable", async () => {
  const loaded = await loadPiSdk("__missing_pi_sdk_for_kca_tests__");
  assert.equal(loaded.ok, false);
  assert.equal(loaded.mode, "fake");
});

test("pi adapter fake session is deterministic enough for local runtime tests", async () => {
  const previous = process.env.KCA_PI_SDK_PACKAGE;
  process.env.KCA_PI_SDK_PACKAGE = "__missing_pi_sdk_for_kca_tests__";
  const session = await startPiSession({
    task: { id: "KCA-PI", title: "Run fake Pi" },
    agentId: "engineering",
    runId: "run_fake",
    cwd: "/tmp/kca",
    prompt: "Implement task"
  });
  if (previous === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
  else process.env.KCA_PI_SDK_PACKAGE = previous;
  assert.equal(session.mode, "fake");
  assert.equal(session.sessionId, "run_fake");
});

test("pi adapter tool contracts execute effects through injected context", async () => {
  const calls = [];
  const tools = buildKanbanTools({
    sdkExports: { defineTool: (tool) => tool },
    createTask: async (input) => {
      calls.push({ type: "createTask", input });
      return { id: "KCA-MOCK", title: input.title };
    },
    moveTask: async (taskId, column) => {
      calls.push({ type: "moveTask", taskId, column });
      return { id: taskId, column };
    }
  });
  const create = tools.find((tool) => tool.name === "kca_create_task");
  const move = tools.find((tool) => tool.name === "kca_move_task");
  assert.equal(create.parameters.properties.title.type, "string");
  await create.execute("call-create", { title: "Mock task", projectTargets: ["kanban-code-agent"] });
  await move.execute("call-move", { taskId: "KCA-MOCK", column: "build" });
  assert.deepEqual(calls, [
    { type: "createTask", input: { title: "Mock task", description: "", column: "manager", projectTargets: ["kanban-code-agent"] } },
    { type: "moveTask", taskId: "KCA-MOCK", column: "build" }
  ]);
});

test("task agent tools execute typed workflow commands and emit tool events", async () => {
  const commands = [];
  const events = [];
  const tools = buildTaskAgentTools({
    sdkExports: { defineTool: (tool) => tool },
    taskId: "KCA-TOOLS",
    runId: "run_tools",
    role: "engineering",
    agentId: "engineering",
    executeCommand: async (command) => {
      commands.push(command);
      return { ok: true, commandId: command.commandId };
    },
    onEvent: async (event) => events.push(event)
  });
  const complete = tools.find((tool) => tool.name === "complete_task");
  const artifact = tools.find((tool) => tool.name === "emit_artifact");
  await complete.execute("call-complete", { nextColumn: "validate", summary: "done" });
  await artifact.execute("call-artifact", { path: "evidence.md", content: "ok" });
  assert.deepEqual(commands.map((command) => command.type), ["agent.complete_task", "agent.emit_artifact"]);
  assert.equal(commands[0].taskId, "KCA-TOOLS");
  assert.equal(commands[0].runId, "run_tools");
  assert.deepEqual(events.map((event) => event.type), ["agent.tool_call", "agent.tool_result", "agent.tool_call", "agent.tool_result"]);
});

test("board assistant returns on prompt timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-timeout-"));
  const modulePath = join(root, "hanging-pi-sdk.mjs");
  await writeFile(modulePath, `
    export const VERSION = "test";
    export const SessionManager = { create: () => ({}) };
    export const defineTool = (tool) => tool;
    export async function createAgentSession() {
      return {
        session: {
          setSessionName() {},
          subscribe() { return () => {}; },
          prompt() { return new Promise(() => {}); },
          dispose() {}
        },
        modelFallbackMessage: null
      };
    }
  `);
  const previousPackage = process.env.KCA_PI_SDK_PACKAGE;
  const previousTimeout = process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS;
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  process.env.KCA_PI_SDK_PACKAGE = modulePath;
  process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS = "20";
  delete process.env.KCA_PI_ADAPTER;
  try {
    const started = Date.now();
    const result = await runBoardAssistant({ prompt: "trave", agentId: "assistant", root, context: {} });
    assert.equal(result.ok, false);
    assert.equal(result.timeout, true);
    assert.ok(Date.now() - started < 1000);
  } finally {
    if (previousPackage === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
    else process.env.KCA_PI_SDK_PACKAGE = previousPackage;
    if (previousTimeout === undefined) delete process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS;
    else process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS = previousTimeout;
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
  }
});

test("task prompt timeout is independent from Pi session creation timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-timeout-split-"));
  const modulePath = join(root, "slow-prompt-pi-sdk.mjs");
  await writeFile(modulePath, `
    export const VERSION = "test";
    export const SessionManager = { create: () => ({ getSessionId: () => "slow-session", getSessionFile: () => "slow-session.jsonl" }) };
    export const defineTool = (tool) => tool;
    export async function createAgentSession() {
      return {
        session: {
          sessionId: "slow-session",
          sessionFile: "slow-session.jsonl",
          setSessionName() {},
          getActiveToolNames() { return []; },
          subscribe() { return () => {}; },
          async prompt(_text, options) {
            options?.preflightResult?.(true);
            await new Promise((resolve) => setTimeout(resolve, 60));
          },
          dispose() {}
        },
        modelFallbackMessage: null
      };
    }
  `);
  const previousPackage = process.env.KCA_PI_SDK_PACKAGE;
  const previousAdapter = process.env.KCA_PI_ADAPTER;
  const previousSessionTimeout = process.env.KCA_PI_SESSION_TIMEOUT_MS;
  const previousPromptTimeout = process.env.KCA_TASK_AGENT_TIMEOUT_MS;
  process.env.KCA_PI_SDK_PACKAGE = modulePath;
  process.env.KCA_PI_SESSION_TIMEOUT_MS = "20";
  process.env.KCA_TASK_AGENT_TIMEOUT_MS = "500";
  delete process.env.KCA_PI_ADAPTER;
  try {
    const session = await startPiSession({
      task: { id: "KCA-SLOW", title: "Slow prompt" },
      agentId: "engineering",
      runId: "run_slow",
      cwd: root,
      sessionDir: join(root, "sessions"),
      prompt: "Complete slowly.",
      runPrompt: true
    });
    assert.equal(session.mode, "real");
    assert.equal(session.promptSent, true);
    assert.equal(session.reason, undefined);
  } finally {
    if (previousPackage === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
    else process.env.KCA_PI_SDK_PACKAGE = previousPackage;
    if (previousAdapter === undefined) delete process.env.KCA_PI_ADAPTER;
    else process.env.KCA_PI_ADAPTER = previousAdapter;
    if (previousSessionTimeout === undefined) delete process.env.KCA_PI_SESSION_TIMEOUT_MS;
    else process.env.KCA_PI_SESSION_TIMEOUT_MS = previousSessionTimeout;
    if (previousPromptTimeout === undefined) delete process.env.KCA_TASK_AGENT_TIMEOUT_MS;
    else process.env.KCA_TASK_AGENT_TIMEOUT_MS = previousPromptTimeout;
  }
});

test("pi adapter loads verified SDK and creates a dry-run AgentSession", { skip: realPiEnabled ? false : "set KCA_PI_REAL_TESTS=1 to run Pi SDK smoke tests" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-real-"));
  const loaded = await loadPiSdk();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(loaded.version, "0.79.1");
  assert.equal(loaded.api.createAgentSession, true);
  assert.equal(loaded.api.SessionManager, true);

  const session = await startPiSession({
    task: { id: "KCA-PI-REAL", title: "Dry run Pi session" },
    agentId: "engineering",
    runId: "run_real",
    cwd: root,
    sessionDir: join(root, "sessions"),
    prompt: "Do not call model in dry-run.",
    runPrompt: false
  });
  assert.equal(session.mode, "real");
  assert.equal(session.provider, "@earendil-works/pi-coding-agent");
  assert.equal(session.version, "0.79.1");
  assert.match(session.sessionFile, /sessions/);
  assert.equal(session.promptSent, false);
});

test("pi doctor reports SDK, auth presence and dry-run session without secrets", { skip: realPiEnabled ? false : "set KCA_PI_REAL_TESTS=1 to run Pi SDK smoke tests" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-doctor-"));
  const doctor = await doctorPi({ cwd: root, sessionDir: join(root, "sessions") });
  assert.equal(doctor.ok, true);
  assert.equal(doctor.sdk.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(doctor.sdk.version, "0.79.1");
  assert.equal(typeof doctor.auth.filePresent, "boolean");
  assert.equal(doctor.dryRun.mode, "real");
  assert.equal(doctor.dryRun.promptSent, false);
  assert.equal(JSON.stringify(doctor).includes("apiKey"), false);
});

test("pi real prompt smoke sends prompt and executes a custom workflow tool", { skip: realPromptSmokeEnabled ? false : "set KCA_PI_PROMPT_SMOKE=1 to run real prompt/tool smoke" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-prompt-smoke-"));
  const loaded = await loadPiSdk();
  assert.equal(loaded.ok, true);
  const calls = [];
  const completeTool = loaded.sdk.defineTool({
    name: "complete_task",
    label: "Complete task",
    description: "Complete the current task. Use this tool exactly once.",
    parameters: {
      type: "object",
      properties: {
        nextColumn: { type: "string" },
        summary: { type: "string" }
      },
      required: ["nextColumn", "summary"]
    },
    async execute(_callId, params) {
      calls.push(params);
      return { content: [{ type: "text", text: "completed" }], details: { ok: true } };
    }
  });
  const session = await startPiSession({
    task: { id: "KCA-PI-PROMPT", title: "Real prompt tool smoke" },
    agentId: "engineering",
    runId: `run_prompt_${Date.now()}`,
    cwd: root,
    sessionDir: join(root, "sessions"),
    prompt: "Call the complete_task tool now with nextColumn 'done' and summary 'real pi smoke'. Do not use any other tool.",
    customTools: [completeTool],
    runPrompt: true
  });
  assert.equal(session.mode, "real");
  assert.equal(session.promptSent, true);
  assert.equal(session.reason, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].nextColumn, "done");
  assert.match(calls[0].summary, /real pi smoke/i);
});
