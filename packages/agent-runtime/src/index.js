import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { appendJsonl, listTasks, paths, readAgent, readSettings, readSkill, writeAtomic } from "@kca/fsdb";
import { compactTaskPersonaChat, readChatHistory, readTaskComments } from "@kca/fsdb/chat-store";
import { buildTaskAgentTools, startOpenAICompatibleSession, startPiSession } from "@kca/pi-adapter";
import { logStep } from "@kca/core/log";
import { AGENT_RESPONSE_POLICY } from "@kca/core/agent-response-policy";
import { discoverProviders, resolveProviderModel } from "@kca/core/providers";
import { roleById } from "../../core/src/roles.js";

export function createRunId(taskId, agentId) {
  return `run_${taskId}_${agentId}_${Date.now()}`;
}

function toolsForAgent(agentConfig) {
  const tools = agentConfig?.tools;
  const resolved = Array.isArray(tools) ? tools : [...(tools?.builtin || []), ...(tools?.custom || [])];
  const required = ["wait_for_persona", "spawn_subtasks", "review_subtask", "answer_subtask_question"];
  return [...new Set([...resolved, ...required])];
}

function formatChatMessages(messages = []) {
  const visible = messages.filter((message) => message?.text).slice(-12);
  if (!visible.length) return "";
  return [
    "# Recent Task Chat",
    ...visible.map((message) => {
      const who = message.role === "user" ? "user" : message.persona || message.agentId || "assistant";
      const disposition = message.disposition ? ` [${message.disposition}]` : "";
      return `- ${who}${disposition}: ${String(message.text).replace(/\s+/g, " ").slice(0, 1000)}`;
    })
  ].join("\n");
}

export async function buildAgentChat(task, root, { persona = task.routing?.currentRole || task.routing?.currentAgent || "assistant", agentId = task.routing?.currentAgent || persona, provider, model, effort } = {}) {
  logStep("agent-runtime", "buildAgentChat.start", { taskId: task.id, persona, agentId });
  const p = paths(root);
  const role = roleById(persona);
  const agentConfig = await readAgent(agentId, root);
  let instructions = "";
  if (agentConfig?.instructionsPath) {
    try {
      instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
    } catch {
      instructions = "";
    }
  }
  let description = "";
  let acceptance = "";
  let planning = "";
  let taskSpec = "";
  let validationReport = "";
  try {
    description = await readFile(join(p.tasks, task.id, "description.md"), "utf8");
  } catch {}
  try {
    acceptance = await readFile(join(p.tasks, task.id, "acceptance.md"), "utf8");
  } catch {}
  try {
    planning = await readFile(join(p.tasks, task.id, "planning.yaml"), "utf8");
  } catch {}
  try {
    taskSpec = await readFile(join(p.tasks, task.id, "task-spec.md"), "utf8");
  } catch {}
  try {
    validationReport = await readFile(join(p.tasks, task.id, "validation-report.md"), "utf8");
  } catch {}
  const messages = await readChatHistory(root, { scope: "task", taskId: task.id, persona, limit: 200 });
  const visibleMessages = await readTaskComments(root, { taskId: task.id, limit: 200 }).catch(() => messages);
  const directSubtasks = (await listTasks(root))
    .filter((item) => (item.parentTaskId || item.worktree?.parentTaskId) === task.id)
    .map((item) => ({ id: item.id, title: item.title, status: item.status, column: item.column, role: item.routing?.currentRole || item.routing?.currentAgent || null }));
  const tools = toolsForAgent(agentConfig).map((name) => ({ name }));
  const settings = await readSettings(root);
  const resolvedModel = resolveProviderModel({ settings, agentConfig, role, provider, model, effort });
  const providerId = resolvedModel.provider;
  const modelName = resolvedModel.model;
  const modelEffort = resolvedModel.effort;
  const system = {
    role: "system",
    content: [
      "Kanban Code Agent runtime.",
      "Use typed tools for disposition, handoff, human wait, artifacts, and completion.",
      "Never move the current task to another persona; create a child subtask when another persona is needed.",
      "Agents do not share raw chat context; only explicit artifacts and delegation messages cross personas.",
      "Every chat message from an agent must include persona.",
      "A run is terminal only after a state-changing tool call such as complete_task, report_blocker, wait_for_persona, delegate_task, or request_user_input.",
      "Prompt-only safety contract: treat the task worktree as the only allowed filesystem scope; do not read or write outside it.",
      AGENT_RESPONSE_POLICY,
      `Persona: ${persona}.`,
      role?.gate ? `Gate: ${role.gate}` : "",
      instructions
    ].filter(Boolean).join("\n")
  };
  const taskContext = {
    role: "task",
    content: [
      `id: ${task.id}`,
      `title: ${task.title}`,
      `column: ${task.column}`,
      `status: ${task.status}`,
      `parentTaskId: ${task.parentTaskId || task.worktree?.parentTaskId || ""}`,
      `rootTaskId: ${task.rootTaskId || task.worktree?.mainTaskId || task.id}`,
      `depth: ${Number.isInteger(task.depth) ? task.depth : task.parentTaskId || task.worktree?.parentTaskId ? 1 : 0}`,
      `persona: ${persona}`,
      `agent: ${agentId}`,
      `run: ${task.agent?.currentRunId || ""}`,
      "recursive_rule: if this task has parentTaskId, never ask the human directly; call request_user_input only to raise the question to the parent manager, and wait for answer_subtask_question to resume.",
      "allowed_filesystem_scope: task worktree only",
      "description:",
      description,
      "acceptance:",
      acceptance,
      "planning:",
      planning,
      "workflow:",
      JSON.stringify(task.workflow || {}),
      "direct_subtasks:",
      JSON.stringify(directSubtasks),
      "task-spec:",
      taskSpec,
      "validation-report:",
      validationReport,
      `dependencies: ${JSON.stringify(task.dependencies || {})}`,
      `worktree: ${JSON.stringify(task.worktree || {})}`,
      "scope_note: The current implementation communicates this scope in the prompt; host-level filesystem sandboxing remains pending."
    ].join("\n")
  };
  const toolcalls = messages.flatMap((message) => [...(message.toolCalls || []), ...(message.toolResults || [])]);
  const sourceRefs = [`tasks/${task.id}/task.yaml`, `tasks/${task.id}/description.md`, `tasks/${task.id}/task-spec.md`, `tasks/${task.id}/acceptance.md`, `tasks/${task.id}/validation-report.md`, `tasks/${task.id}/planning.yaml`, `tasks/${task.id}/chats/${persona}/active.jsonl`];
  const hashInput = JSON.stringify({ system, taskContext, messages, visibleMessages, directSubtasks, toolcalls, tools, providerId, modelName, modelEffort });
  const result = {
    schema: "kanban-code-agent/agent-chat-build@1",
    chatKind: "task_execution",
    taskId: task.id,
    persona,
    agentId,
    provider: providerId,
    model: modelName,
    effort: modelEffort,
    modelResolution: resolvedModel,
    system,
    task: taskContext,
    messages,
    visibleMessages,
    directSubtasks,
    toolcalls,
    tools,
    sourceRefs,
    promptHash: createHash("sha256").update(hashInput).digest("hex")
  };
  logStep("agent-runtime", "buildAgentChat.done", { taskId: task.id, persona, agentId });
  return result;
}

export async function startRun(task, root, agentId = task.routing?.currentAgent || "assistant", options = {}) {
  logStep("agent-runtime", "startRun.start", { taskId: task.id, agentId });
  const p = paths(root);
  const runId = options.runId || createRunId(task.id, agentId);
  logStep("agent", "run.start", { taskId: task.id, agentId, runId });
  const sessionDir = join(p.runtime, "sessions", task.id, agentId);
  const sessionRef = join("settings/runtime/sessions", task.id, agentId, "session.jsonl");
  const summaryRef = join("summaries", `run-${runId}.md`);
  const previousSessionRef = task.agent?.currentSessionRef || null;
  const previousSummaryRef = task.agent?.lastSummary || null;
  let previousSummary = "";
  if (previousSummaryRef) {
    try {
      previousSummary = await readFile(join(p.tasks, task.id, previousSummaryRef), "utf8");
    } catch {
      previousSummary = "";
    }
  }
  const started = {
    ts: new Date().toISOString(),
    type: "agent.started",
    actor: "orchestrator",
    taskId: task.id,
    agent: agentId,
    runId
  };
  await mkdir(sessionDir, { recursive: true });
  const agentConfig = await readAgent(agentId, root);
  const configuredSkills = await Promise.all((agentConfig?.skills || task.skills?.active || []).map((skillId) => readSkill(skillId, root)));
  let instructions = "";
  if (agentConfig?.instructionsPath) {
    try {
      instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
    } catch {
      instructions = "";
    }
  }
  let description = "";
  try {
    description = await readFile(join(p.tasks, task.id, "description.md"), "utf8");
  } catch {
    description = "";
  }
  const role = options.role || task.routing?.currentRole || task.routing?.currentAgent || agentId;
  const scope = options.scope || (task.kind === "assistant" ? "board" : "task");
  const allowedTools = options.allowedTools || toolsForAgent(agentConfig);
  const settings = await readSettings(root);
  const adapterMaxTurns = settings.runtime?.agentMaxTurns || 24;
  const maxActiveMessages = settings.runtime?.chatCompaction?.maxActiveMessages ?? 50;
  if (scope === "task" && maxActiveMessages > 0) {
    const activeMessages = await readChatHistory(root, { scope: "task", taskId: task.id, persona: role, limit: maxActiveMessages + 1 });
    const hasPendingToolCall = activeMessages.some((message) => (message.toolCalls || []).length && !(message.toolResults || []).length);
    if (activeMessages.length > maxActiveMessages && !hasPendingToolCall) {
      logStep("agent-runtime", "startRun.compact_chat", { taskId: task.id, persona: role, activeMessages: activeMessages.length });
      await appendJsonl(join(p.tasks, task.id, "events.jsonl"), { ts: new Date().toISOString(), type: "chat.compaction_requested", actor: role, taskId: task.id, reason: "maxActiveMessages", maxActiveMessages });
      const compaction = await compactTaskPersonaChat(root, {
        taskId: task.id,
        persona: role,
        summary: `Compactação automática antes de ${runId}. Mensagens preservadas no histórico.`,
        tokenStats: { messageCount: activeMessages.length, maxActiveMessages }
      });
      await appendJsonl(join(p.tasks, task.id, "events.jsonl"), { ts: new Date().toISOString(), type: "chat.compacted", actor: role, taskId: task.id, ...compaction });
    }
  }
  const chatBuild = await buildAgentChat(task, root, { persona: role, agentId });
  const prompt = [
    chatBuild.system.content,
    chatBuild.task.content,
    chatBuild.tools?.length ? `# Allowed Tools\n\n${chatBuild.tools.map((tool) => `- ${tool.name}`).join("\n")}` : "",
    formatChatMessages(chatBuild.visibleMessages?.length ? chatBuild.visibleMessages : chatBuild.messages),
    previousSummary ? `# Previous Session Summary\n\n${previousSummary}` : ""
  ].filter(Boolean).join("\n\n");
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const runRecord = { ts: new Date().toISOString(), type: "agent.run", actor: "orchestrator", taskId: task.id, runId, agentId, role, scope, allowedTools, promptHash, provider: chatBuild.provider, model: chatBuild.model, effort: chatBuild.effort, chatBuild };
  await appendJsonl(join(sessionDir, "session.jsonl"), started);
  await appendJsonl(join(sessionDir, "session.jsonl"), runRecord);
  await appendJsonl(join(p.tasks, task.id, "events.jsonl"), runRecord);
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.config", actor: "orchestrator", taskId: task.id, runId, agent: agentConfig, skills: configuredSkills.filter(Boolean), resume: { previousSessionRef, previousSummaryRef } });
  await options.beforePrompt?.({ runId, agentId, role, scope, allowedTools, promptHash, sessionRef, summaryRef, previousSessionRef, previousSummaryRef, event: started, chatBuild });
  let transcriptStreamLogged = false;
  const onToolEvent = async (event) => {
    const entry = { ts: new Date().toISOString(), actor: role, taskId: task.id, runId, ...event };
    if (event.type === "agent.transcript") {
      if (!transcriptStreamLogged) {
        transcriptStreamLogged = true;
        logStep("agent", "stream.start", { taskId: task.id, runId, agentId, role });
      }
    } else {
      logStep("agent", event.type || "event", { taskId: task.id, runId, agentId, role, tool: event.tool, ok: event.ok });
    }
    await appendJsonl(join(sessionDir, "session.jsonl"), entry);
    await appendJsonl(join(p.tasks, task.id, "events.jsonl"), entry);
  };
  let adapter;
  try {
    const providerDiscovery = discoverProviders(settings);
    const activeProvider = providerDiscovery.providers.find((item) => item.id === chatBuild.provider && item.active);
    const legacyFallback = !providerDiscovery.providers.some((item) => item.active) && chatBuild.modelResolution?.inheritedProvider;
    const commonAdapterOptions = {
      task,
      agentId,
      role,
      runId,
      cwd: task.worktree?.path || p.root,
      prompt,
      customToolFactory: ({ sdkExports, getLastAssistantText }) => buildTaskAgentTools({
        sdkExports,
        taskId: task.id,
        runId,
        agentId,
        role,
        executeCommand: options.executeCommand,
        onEvent: onToolEvent,
        getLastAssistantText
      }, { allowedTools }),
      onEvent: onToolEvent,
      maxTurns: adapterMaxTurns
    };
    adapter = activeProvider
      ? await startOpenAICompatibleSession({ ...commonAdapterOptions, providerConfig: activeProvider, model: chatBuild.model })
      : legacyFallback
        ? await startPiSession({
        ...commonAdapterOptions,
        sessionDir,
        previousSessionFile: previousSessionRef ? join(p.root, previousSessionRef) : undefined,
        instructionsPath: agentConfig?.instructionsPath,
        skills: configuredSkills.filter(Boolean),
        runPrompt: true,
        legacyFallback
      })
        : { mode: "failed", provider: chatBuild.provider, reason: "provider_inactive", sessionId: runId, cwd: task.worktree?.path || p.root, promptSent: false };
  } finally {
    if (transcriptStreamLogged) logStep("agent", "stream.end", { taskId: task.id, runId, agentId, role });
  }
  logStep("agent-runtime", "startRun.adapter_ready", { taskId: task.id, agentId, runId });
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.adapter", actor: "orchestrator", taskId: task.id, runId, adapter });
  if (adapter.promptSent) {
    const promptSent = { ts: new Date().toISOString(), type: "agent.prompt_sent", actor: "orchestrator", taskId: task.id, runId, agentId, cwd: adapter.cwd };
    logStep("agent", "prompt.sent", { taskId: task.id, runId, agentId, cwd: adapter.cwd });
    await appendJsonl(join(sessionDir, "session.jsonl"), promptSent);
    await appendJsonl(join(p.tasks, task.id, "events.jsonl"), promptSent);
  }
  logStep("agent", adapter.reason ? "run.adapter_result" : "run.ready", { taskId: task.id, runId, agentId, mode: adapter.mode, reason: adapter.reason });
  logStep("agent-runtime", "startRun.done", { taskId: task.id, agentId, runId });
  return { runId, agentId, role, scope, allowedTools, promptHash, sessionRef, summaryRef, previousSessionRef, previousSummaryRef, event: started, adapter };
}

export async function interruptRun(task, root, mode = "soft") {
  logStep("agent-runtime", "interruptRun.start", { taskId: task.id, mode });
  const p = paths(root);
  const agentId = task.routing?.currentAgent || task.agent?.currentAgent || "assistant";
  const runId = task.agent?.currentRunId || null;
  const event = {
    ts: new Date().toISOString(),
    type: "agent.interrupted",
    actor: "orchestrator",
    taskId: task.id,
    agent: agentId,
    runId,
    mode
  };
  await appendJsonl(join(p.runtime, "sessions", task.id, agentId, "session.jsonl"), event);
  logStep("agent-runtime", "interruptRun.done", { taskId: task.id, mode });
  return event;
}

export async function writeRunSummary(task, root, runId, summary) {
  logStep("agent-runtime", "writeRunSummary.start", { taskId: task.id, runId });
  const p = paths(root);
  const summaryPath = join(p.tasks, task.id, "summaries", `run-${runId}.md`);
  await writeAtomic(summaryPath, `# Run ${runId}\n\n${summary || "Sem resumo."}\n`);
  logStep("agent-runtime", "writeRunSummary.done", { taskId: task.id, runId });
  return join("summaries", `run-${runId}.md`);
}
