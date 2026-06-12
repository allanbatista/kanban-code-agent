export function parentMergeSemaphore(parentTaskId) {
  return `parent:${parentTaskId}:merge`;
}

export function findParentMergeBusy(tasks, currentTask) {
  const parentTaskId = currentTask.worktree?.parentTaskId;
  if (!parentTaskId) return null;
  return tasks.find((task) => task.id !== currentTask.id && task.status === "merge_pending" && task.worktree?.parentTaskId === parentTaskId) || null;
}
