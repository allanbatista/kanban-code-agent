import { join } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { appendJsonl, paths, readJsonl, writeAtomic } from "./index.js";
import { logStep } from "@kca/core/log";

function chatPath(root, scope = "board", taskId, persona = "assistant") {
  const p = paths(root);
  if (scope === "task" && taskId) return join(p.tasks, taskId, "chats", persona || "assistant", "active.jsonl");
  return join(p.runtime, "sessions", "board-chat.jsonl");
}

export async function appendChatMessage(root, { scope = "board", taskId, role, persona, agentId = "assistant", text, commandId, runId, disposition, visibility = "chat", toolCalls = [], toolResults = [], chatId, generation = 1 }) {
  const effectivePersona = persona || agentId || role || "assistant";
  logStep("fsdb", "appendChatMessage.start", { scope, taskId: taskId || null, role, persona: effectivePersona });
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    scope,
    taskId: taskId || null,
    role,
    persona: effectivePersona,
    agentId,
    commandId,
    runId,
    disposition,
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
