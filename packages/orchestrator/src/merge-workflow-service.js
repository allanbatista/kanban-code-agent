import { appendJsonl, paths, updateTask } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { mergeSubtask } from "@kca/git-worktree";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";
import { findParentMergeBusy } from "./merge-coordinator.js";

export async function mergeTaskWorkflow(command, current, tasks, root) {
  const parentTaskId = current.worktree?.parentTaskId;
  if (parentTaskId) {
    const busy = findParentMergeBusy(tasks, current);
    if (busy) {
      logStep("merge-workflow", "task.merge.blocked", { taskId: command.taskId, busyTaskId: busy.id });
      const message = `Parent merge is busy with ${busy.id}.`;
      await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: "manager", agentId: "manager", disposition: "merge.blocked", text: message, visibility: "both" });
      const task = TaskSchema.parse(await updateTask(command.taskId, {
        status: "blocked",
        column: current.column,
        routing: current.routing,
        dependencies: { ...current.dependencies, blockedBy: [] }
      }, root, "task.problem"));
      return { ok: false, commandId: command.commandId, task, merge: { ok: false, status: "blocked", reason: "parent_merge_busy", parentTaskId, busyTaskId: busy.id } };
    }
  }
  await updateTask(command.taskId, { status: "merge_pending" }, root, "merge.requested");
  const merge = await mergeSubtask({
    parentPath: command.parentPath || current.worktree?.mergeParentPath || current.worktree?.repoPath,
    subtaskBranch: command.subtaskBranch || current.worktree?.branch
  });
  if (merge.status === "merged") {
    logStep("merge-workflow", "task.merge.done", { taskId: command.taskId });
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "merge.completed", actor: "orchestrator", taskId: command.taskId, branch: command.subtaskBranch || current.worktree?.branch });
    const task = TaskSchema.parse(await updateTask(command.taskId, { status: "done", column: "done" }, root, "subtask.merged"));
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task, merge };
  }
  logStep("merge-workflow", "task.merge.conflict", { taskId: command.taskId, reason: merge.reason });
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "merge.conflict", actor: "orchestrator", taskId: command.taskId, branch: command.subtaskBranch || current.worktree?.branch, reason: merge.reason });
  await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: "manager", agentId: "manager", disposition: "merge.conflict", text: merge.reason || "Merge failed.", visibility: "both" });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "blocked",
    column: current.column,
    routing: current.routing,
    dependencies: { ...current.dependencies, blockedBy: [] }
  }, root, "task.problem"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: false, commandId: command.commandId, task, merge };
}
