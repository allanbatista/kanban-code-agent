import { join } from "node:path";
import { appendJsonl, paths, readJsonl } from "./index.js";

function chatPath(root, scope = "board", taskId) {
  const p = paths(root);
  if (scope === "task" && taskId) return join(p.tasks, taskId, "chat.jsonl");
  return join(p.runtime, "sessions", "board-chat.jsonl");
}

export async function appendChatMessage(root, { scope = "board", taskId, role, agentId = "assistant", text, commandId, runId }) {
  const message = {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    scope,
    taskId: taskId || null,
    role,
    agentId,
    commandId,
    runId,
    text: String(text || "")
  };
  await appendJsonl(chatPath(root, scope, taskId), message);
  return message;
}

export async function readChatHistory(root, { scope = "board", taskId, limit = 100 } = {}) {
  const messages = await readJsonl(chatPath(root, scope, taskId));
  return messages.slice(-limit);
}
