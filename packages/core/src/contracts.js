export const COMMAND_TYPES = [
  "task.create",
  "task.update",
  "task.file.write",
  "task.move",
  "task.run",
  "task.interrupt",
  "task.decompose",
  "task.merge",
  "scheduler.tick",
  "agent.complete_task",
  "agent.report_blocker",
  "agent.request_user_input",
  "agent.emit_artifact",
  "agent.chat",
  "settings.update"
];

export const QUERY_TYPES = [
  "board.snapshot",
  "task.detail",
  "task.files",
  "orchestrator.status",
  "settings.scope",
  "chat.history",
  "why_not_running"
];

export const EVENT_TYPES = [
  "task.created",
  "task.updated",
  "planning.created",
  "planning.updated",
  "task.move_requested",
  "task.moved",
  "task.blocked",
  "task.unblocked",
  "task.recovered",
  "agent.queued",
  "agent.started",
  "agent.event",
  "chat.message",
  "agent.checkpoint_requested",
  "agent.interrupted",
  "agent.completed",
  "agent.failed",
  "agent.input_requested",
  "artifact.emitted",
  "hook.started",
  "hook.completed",
  "hook.failed",
  "worktree.created",
  "worktree.updated",
  "worktree.removed",
  "subtasks.spawned",
  "scheduler.tick",
  "subtask.merged",
  "merge.requested",
  "merge.completed",
  "merge.conflict",
  "settings.updated"
];

export const ROLE_IDS = ["manager", "product", "design", "engineering", "quality", "review", "deployment"];

export function commandEnvelope(type, payload = {}) {
  return { type, commandId: payload.commandId || `cmd-${Date.now()}`, ...payload };
}

export function queryEnvelope(type, payload = {}) {
  return { type, ...payload };
}
