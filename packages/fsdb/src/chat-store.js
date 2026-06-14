import { join } from "node:path";
import { mkdir, readdir, rename } from "node:fs/promises";
import { appendJsonl, paths, readJsonl, writeAtomic } from "./index.js";
import { logStep } from "@kca/core/log";

function chatPath(root, scope = "board", taskId, persona = "assistant") {
  const p = paths(root);
  if (scope === "task" && taskId) return join(p.tasks, taskId, "chats", persona || "assistant", "active.jsonl");
  return join(p.runtime, "sessions", "board-chat.jsonl");
}

function normalizeMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export async function appendChatMessage(root, { scope = "board", taskId, role, persona, displayPersona, agentId = "assistant", text, commandId, runId, disposition, visibility = "chat", toolCalls = [], toolResults = [], chatId, generation = 1, replyToMessageId }) {
  const effectivePersona = persona || agentId || role || "assistant";
  logStep("fsdb", "appendChatMessage.start", { scope, taskId: taskId || null, role, persona: effectivePersona });
  if (visibility !== "timeline") {
    const existing = await readJsonl(chatPath(root, scope, taskId, effectivePersona));
    const normalized = normalizeMessageText(text);
    const duplicate = [...existing].reverse().slice(0, 20).find((message) => (
      message.role === role
      && message.disposition === disposition
      && normalizeMessageText(message.text) === normalized
    ));
    if (duplicate) {
      logStep("fsdb", "appendChatMessage.dedupe", { scope, taskId: taskId || null, persona: effectivePersona });
      return { ...duplicate, idempotent: true };
    }
  }
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    scope,
    taskId: taskId || null,
    role,
    persona: effectivePersona,
    displayPersona,
    agentId,
    commandId,
    runId,
    disposition,
    replyToMessageId,
    visibility,
    toolCalls,
    toolResults,
    chatId: chatId || `${taskId || scope}-${effectivePersona}-active`,
    generation,
    text: String(text || "")
  };
  await appendJsonl(chatPath(root, scope, taskId, effectivePersona), message);
  logStep("fsdb", "appendChatMessage.done", { scope, taskId: taskId || null, persona: effectivePersona });
  return message;
}

export async function readChatHistory(root, { scope = "board", taskId, persona = "assistant", limit = 100 } = {}) {
  logStep("fsdb", "readChatHistory", { scope, taskId: taskId || null, persona, limit });
  const messages = await readJsonl(chatPath(root, scope, taskId, persona));
  return messages.slice(-limit);
}

export async function readTaskComments(root, { taskId, limit = 100 } = {}) {
  if (!taskId) throw new Error("readTaskComments requires taskId");
  logStep("fsdb", "readTaskComments", { taskId, limit });
  const p = paths(root);
  const chatRoot = join(p.tasks, taskId, "chats");
  const personas = await readdir(chatRoot, { withFileTypes: true }).catch(() => []);
  const messages = (await Promise.all(personas
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJsonl(join(chatRoot, entry.name, "active.jsonl"))))).flat();
  return messages
    .filter((message) => message.visibility !== "timeline")
    .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))
    .slice(-limit);
}

export async function resetBoardChat(root, { agentId = "assistant" } = {}) {
  logStep("fsdb", "resetBoardChat.start", { agentId });
  const p = paths(root);
  const fromPath = chatPath(root, "board", null, agentId);
  const messages = await readJsonl(fromPath);
  let historyPath = null;
  if (messages.length) {
    const historyId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await mkdir(join(p.runtime, "sessions", "board-chat-history"), { recursive: true });
    historyPath = join("sessions", "board-chat-history", `${historyId}.jsonl`);
    await rename(fromPath, join(p.runtime, historyPath));
  } else {
    await writeAtomic(fromPath, "");
  }
  logStep("fsdb", "resetBoardChat.done", { messageCount: messages.length, historyPath });
  return { schema: "kanban-code-agent/board-chat-reset@1", messageCount: messages.length, historyPath };
}

export async function compactTaskPersonaChat(root, { taskId, persona = "assistant", summary, tokenStats = {} }) {
  if (!taskId) throw new Error("compactTaskPersonaChat requires taskId");
  logStep("fsdb", "compactTaskPersonaChat.start", { taskId, persona });
  const p = paths(root);
  const fromPath = chatPath(root, "task", taskId, persona);
  const chatId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const base = join(p.tasks, taskId, "chats", persona);
  const historyPath = join(base, "history", `${chatId}.jsonl`);
  const summaryRef = join("chats", persona, "compactions", `${chatId}.md`);
  const summaryPath = join(p.tasks, taskId, summaryRef);
  const messages = await readJsonl(fromPath);
  await mkdir(join(base, "history"), { recursive: true });
  await mkdir(join(base, "compactions"), { recursive: true });
  if (messages.length) await rename(fromPath, historyPath);
  await writeAtomic(summaryPath, `# Compactação ${chatId}\n\n${summary || "Sem resumo."}\n`);
  const seed = await appendChatMessage(root, {
    scope: "task",
    taskId,
    role: "assistant",
    persona,
    agentId: persona,
    disposition: "chat.compacted",
    visibility: "timeline",
    text: summary || "Contexto compactado.",
    chatId: `${taskId}-${persona}-active`,
    generation: (messages.at(-1)?.generation || 1) + 1
  });
  const result = {
    schema: "kanban-code-agent/chat-compaction@1",
    fromChatId: chatId,
    toChatId: seed.chatId,
    historyPath: join("chats", persona, "history", `${chatId}.jsonl`),
    summaryRef,
    tokenStats,
    messageCount: messages.length
  };
  logStep("fsdb", "compactTaskPersonaChat.done", { taskId, persona, messageCount: messages.length });
  return result;
}
