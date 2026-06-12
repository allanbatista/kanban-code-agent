import { logStep } from "@kca/core/log";

export function parentMergeSemaphore(parentTaskId) {
  return `parent:${parentTaskId}:merge`;
}

export function findParentMergeBusy(tasks, currentTask) {
  const parentTaskId = currentTask.worktree?.parentTaskId;
  logStep("orchestrator", "merge.check", { taskId: currentTask.id, parentTaskId });
  if (!parentTaskId) return null;
  const result = tasks.find((task) => task.id !== currentTask.id && task.status === "merge_pending" && task.worktree?.parentTaskId === parentTaskId) || null;
  logStep("orchestrator", "merge.check.done", { taskId: currentTask.id, busy: Boolean(result) });
  return result;
}
