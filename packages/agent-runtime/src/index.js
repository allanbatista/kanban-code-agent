import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { appendJsonl, paths, readAgent, readSettings, readSkill, writeAtomic } from "@kca/fsdb";
import { compactTaskPersonaChat, readChatHistory } from "@kca/fsdb/chat-store";
import { startPiSession } from "@kca/pi-adapter";
import { logStep } from "@kca/core/log";
import { roleById } from "../../core/src/roles.js";

export function createRunId(taskId, agentId) {
  return `run_${taskId}_${agentId}_${Date.now()}`;
}

function toolsForAgent(agentConfig) {
  const tools = agentConfig?.tools;
  if (Array.isArray(tools)) return tools;
  return [...(tools?.builtin || []), ...(tools?.custom || [])];
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
  try {
    description = await readFile(join(p.tasks, task.id, "description.md"), "utf8");
  } catch {}
  try {
    acceptance = await readFile(join(p.tasks, task.id, "acceptance.md"), "utf8");
  } catch {}
  try {
    planning = await readFile(join(p.tasks, task.id, "planning.yaml"), "utf8");
  } catch {}
  const messages = await readChatHistory(root, { scope: "task", taskId: task.id, persona, limit: 200 });
  const tools = toolsForAgent(agentConfig).map((name) => ({ name }));
  const modelConfig = agentConfig?.model || role?.model || {};
  const providerId = provider || modelConfig.provider || agentConfig?.provider || "pi";
  const modelName = model || modelConfig.name || "default";
  const modelEffort = effort || modelConfig.effort || "medium";
  const system = {
    role: "system",
    content: [
      "Kanban Code Agent runtime.",
      "Use typed tools for disposition, handoff, human wait, artifacts, and completion.",
      "Agents do not share raw chat context; only explicit artifacts and delegation messages cross personas.",
      "Every chat message from an agent must include persona.",
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
      `persona: ${persona}`,
      `agent: ${agentId}`,
      `run: ${task.agent?.currentRunId || ""}`,
      "description:",
      description,
      "acceptance:",
      acceptance,
      "planning:",
      planning,
      `dependencies: ${JSON.stringify(task.dependencies || {})}`,
      `worktree: ${JSON.stringify(task.worktree || {})}`
    ].join("\n")
  };
  const toolcalls = messages.flatMap((message) => [...(message.toolCalls || []), ...(message.toolResults || [])]);
  const sourceRefs = [`tasks/${task.id}/task.yaml`, `tasks/${task.id}/description.md`, `tasks/${task.id}/acceptance.md`, `tasks/${task.id}/planning.yaml`, `tasks/${task.id}/chats/${persona}/active.jsonl`];
  const hashInput = JSON.stringify({ system, taskContext, messages, toolcalls, tools, providerId, modelName, modelEffort });
  const result = {
    schema: "kanban-code-agent/agent-chat-build@1",
    chatKind: "task_execution",
    taskId: task.id,
    persona,
    agentId,
    provider: providerId,
    model: modelName,
    effort: modelEffort,
    system,
    task: taskContext,
    messages,
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
  const runId = createRunId(task.id, agentId);
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
    previousSummary ? `# Previous Session Summary\n\n${previousSummary}` : ""
  ].filter(Boolean).join("\n\n");
  const promptHash = createHash("sha256").update(prompt).digest("hex");
  const adapter = await startPiSession({
    task,
    agentId,
    runId,
    cwd: task.worktree?.path || task.worktree?.branch || task.id,
    sessionDir,
    prompt,
    previousSessionFile: previousSessionRef ? join(p.root, previousSessionRef) : undefined,
    instructionsPath: agentConfig?.instructionsPath,
    skills: configuredSkills.filter(Boolean)
  });
  logStep("agent-runtime", "startRun.adapter_ready", { taskId: task.id, agentId, runId });
  await appendJsonl(join(sessionDir, "session.jsonl"), started);
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.run", actor: "orchestrator", taskId: task.id, runId, agentId, role, scope, allowedTools, promptHash, provider: chatBuild.provider, model: chatBuild.model, effort: chatBuild.effort, chatBuild });
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.config", actor: "orchestrator", taskId: task.id, runId, agent: agentConfig, skills: configuredSkills.filter(Boolean), resume: { previousSessionRef, previousSummaryRef } });
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.adapter", actor: "orchestrator", taskId: task.id, runId, adapter });
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
