import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKanbanTools, buildTaskAgentTools, doctorPi, loadPiSdk, runBoardAssistant, startOpenAICompatibleSession, startPiSession } from "../../packages/pi-adapter/src/index.js";

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
  assert.match(artifact.description, /medium or longer/);
  assert.match(artifact.description, /respond directly in chat/);
  await complete.execute("call-complete", { nextColumn: "validate", summary: "done" });
  await artifact.execute("call-artifact", { path: "evidence.md", content: "ok" });
  assert.deepEqual(commands.map((command) => command.type), ["agent.complete_task", "agent.emit_artifact"]);
  assert.equal(commands[0].taskId, "KCA-TOOLS");
  assert.equal(commands[0].runId, "run_tools");
  assert.deepEqual(events.map((event) => event.type), ["agent.tool_call", "agent.tool_result", "agent.tool_call", "agent.tool_result"]);
});

test("run_command tool caps requested timeout", async () => {
  let seen;
  const tools = buildTaskAgentTools({
    sdkExports: { defineTool: (tool) => tool },
    taskId: "KCA-TIMEOUT",
    runId: "run_timeout",
    executeCommand: async (command) => {
      seen = command;
      return { ok: true, commandId: command.commandId, cwd: "/tmp/kca", stdout: "", stderr: "", exitCode: 0 };
    }
  });
  await tools.find((tool) => tool.name === "run_command").execute("call-timeout", { command: "sleep", args: ["1"], timeoutMs: 600000 });
  assert.equal(seen.timeoutMs, 120000);
});

test("task agent tools compact workflow results returned to model", async () => {
  const tools = buildTaskAgentTools({
    sdkExports: { defineTool: (tool) => tool },
    taskId: "KCA-COMPACT",
    runId: "run_compact",
    role: "manager",
    agentId: "manager",
    executeCommand: async (command) => ({
      ok: true,
      commandId: command.commandId,
      task: { id: "KCA-COMPACT", column: "done", status: "done", routing: { currentRole: "generalist", currentAgent: "generalist" } },
      scheduler: { started: [{ taskId: "KCA-COMPACT", result: { run: { adapter: { events: ["large transcript"] } } } }], blocked: [], skipped: [] }
    })
  });
  const delegate = tools.find((tool) => tool.name === "delegate_task");
  const result = await delegate.execute("call-delegate", { toPersona: "generalist", request: "Pesquisar", wait: true });
  assert.deepEqual(result.details.scheduler.started, ["KCA-COMPACT"]);
  assert.equal(JSON.stringify(result).includes("large transcript"), false);
});

test("openai compatible adapter executes task tool calls", async () => {
  const previousKey = process.env.TEST_OPENAI_KEY;
  process.env.TEST_OPENAI_KEY = "test-key";
  const commands = [];
  const events = [];
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({
        id: "chatcmpl-test",
        model: "model-test",
        choices: [{
          message: {
            role: "assistant",
            content: "Resposta final visível.",
            tool_calls: [{
              id: "call-complete",
              type: "function",
              function: { name: "complete_task", arguments: JSON.stringify({ nextColumn: "done", summary: "ok" }) }
            }]
          }
        }]
      })
    };
  };
  try {
    const result = await startOpenAICompatibleSession({
      providerConfig: { id: "test", baseUrl: "https://example.test/v1", apiKeyEnv: "TEST_OPENAI_KEY" },
      model: "model-test",
      task: { id: "KCA-OAI", title: "Run OpenAI compatible" },
      agentId: "engineering",
      runId: "run_oai",
      cwd: "/tmp/kca",
      prompt: "Complete",
      fetchImpl,
      customToolFactory: ({ sdkExports, getLastAssistantText }) => buildTaskAgentTools({
        sdkExports,
        getLastAssistantText,
        taskId: "KCA-OAI",
        runId: "run_oai",
        role: "engineering",
        agentId: "engineering",
        executeCommand: async (command) => {
          commands.push(command);
          return { ok: true, commandId: command.commandId };
        },
        onEvent: async (event) => events.push(event)
      })
    });
    assert.equal(result.mode, "real");
    assert.equal(result.promptSent, true);
    assert.equal(result.terminal, true);
    assert.equal(calls[0].tools.some((tool) => tool.function.name === "complete_task"), true);
    assert.deepEqual(commands.map((command) => command.type), ["agent.complete_task"]);
    assert.equal(commands[0].finalText, "Resposta final visível.");
    assert.deepEqual(events.map((event) => event.type), ["agent.tool_call", "agent.tool_result"]);
  } finally {
    if (previousKey === undefined) delete process.env.TEST_OPENAI_KEY;
    else process.env.TEST_OPENAI_KEY = previousKey;
  }
});

test("openai compatible adapter exposes run_command output to the next turn", async () => {
  const previousKey = process.env.TEST_OPENAI_KEY;
  process.env.TEST_OPENAI_KEY = "test-key";
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return {
      ok: true,
      json: async () => calls.length === 1 ? ({
        id: "chatcmpl-run-command",
        model: "model-test",
        choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-run", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "printf", args: ["cold"] }) } }] } }]
      }) : ({
        id: "chatcmpl-complete",
        model: "model-test",
        choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-complete", type: "function", function: { name: "complete_task", arguments: JSON.stringify({ nextColumn: "done", summary: "saw cold" }) } }] } }]
      })
    };
  };
  try {
    const result = await startOpenAICompatibleSession({
      providerConfig: { id: "test", baseUrl: "https://example.test/v1", apiKeyEnv: "TEST_OPENAI_KEY" },
      model: "model-test",
      task: { id: "KCA-RUN-CMD", title: "Run command" },
      agentId: "generalist",
      runId: "run_cmd",
      cwd: "/tmp/kca",
      fetchImpl,
      customToolFactory: ({ sdkExports }) => buildTaskAgentTools({
        sdkExports,
        taskId: "KCA-RUN-CMD",
        runId: "run_cmd",
        role: "generalist",
        agentId: "generalist",
        executeCommand: async (command) => command.type === "agent.run_command"
          ? { ok: true, commandId: command.commandId, cwd: "/tmp/kca", stdout: "cold\n", stderr: "", exitCode: 0 }
          : { ok: true, commandId: command.commandId }
      })
    });
    assert.equal(result.terminal, true);
    assert.match(calls[1].messages.at(-1).content, /stdout:\ncold/);
  } finally {
    if (previousKey === undefined) delete process.env.TEST_OPENAI_KEY;
    else process.env.TEST_OPENAI_KEY = previousKey;
  }
});

test("openai compatible adapter reports non-terminal text responses", async () => {
  const previousKey = process.env.TEST_OPENAI_KEY;
  process.env.TEST_OPENAI_KEY = "test-key";
  try {
    const result = await startOpenAICompatibleSession({
      providerConfig: { id: "test", baseUrl: "https://example.test/v1", apiKeyEnv: "TEST_OPENAI_KEY" },
      model: "model-test",
      task: { id: "KCA-NONTERM", title: "Non terminal" },
      agentId: "generalist",
      runId: "run_nonterm",
      cwd: "/tmp/kca",
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: "chatcmpl-text", model: "model-test", choices: [{ message: { role: "assistant", content: "only text" } }] }) }),
      customToolFactory: ({ sdkExports }) => buildTaskAgentTools({ sdkExports, taskId: "KCA-NONTERM", runId: "run_nonterm", executeCommand: async () => ({ ok: true }) })
    });
    assert.equal(result.terminal, false);
    assert.equal(result.reason, "non_terminal_response");
  } finally {
    if (previousKey === undefined) delete process.env.TEST_OPENAI_KEY;
    else process.env.TEST_OPENAI_KEY = previousKey;
  }
});

test("openai compatible adapter emits only real provider usage", async () => {
  const previousKey = process.env.TEST_OPENAI_KEY;
  process.env.TEST_OPENAI_KEY = "test-key";
  const events = [];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      id: "chatcmpl-usage",
      model: "model-test",
      usage: {
        prompt_tokens: 250,
        completion_tokens: 75,
        total_tokens: 325,
        prompt_tokens_details: { cached_tokens: 40 }
      },
      choices: [{ message: { role: "assistant", content: "ok" } }]
    })
  });
  try {
    const result = await startOpenAICompatibleSession({
      providerConfig: { id: "test", baseUrl: "https://example.test/v1", apiKeyEnv: "TEST_OPENAI_KEY", contextWindow: 1000 },
      model: "model-test",
      task: { id: "KCA-USAGE", title: "Usage" },
      agentId: "engineering",
      role: "engineering",
      runId: "run_usage",
      cwd: "/tmp/kca",
      prompt: "Report usage",
      fetchImpl,
      customToolFactory: () => [],
      onEvent: async (event) => events.push(event)
    });
    assert.equal(result.mode, "real");
    const usage = events.find((event) => event.type === "agent.usage");
    assert.equal(usage.usage.inputTokens, 250);
    assert.equal(usage.usage.outputTokens, 75);
    assert.equal(usage.usage.totalTokens, 325);
    assert.equal(usage.usage.cacheTokens, 40);
    assert.equal(usage.usage.contextPercent, 32.5);
    assert.equal(usage.provider, "test");
    assert.equal(usage.model, "model-test");
  } finally {
    if (previousKey === undefined) delete process.env.TEST_OPENAI_KEY;
    else process.env.TEST_OPENAI_KEY = previousKey;
  }
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
