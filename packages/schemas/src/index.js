import { z } from "zod";

export const TaskStatus = z.enum(["idle", "queued", "running", "interrupting", "validating", "blocked", "merge_pending", "done", "failed", "canceled", "paused"]);
export const TaskKind = z.enum(["task", "master", "subtask", "spike", "bug", "chore"]);
export const EventType = z.enum([
  "task.created",
  "task.updated",
  "task.move_requested",
  "task.moved",
  "task.blocked",
  "task.unblocked",
  "agent.queued",
  "agent.started",
  "agent.event",
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
  "subtask.merged",
  "merge.requested",
  "merge.blocked",
  "merge.completed",
  "merge.conflict",
  "settings.updated",
  "task.recovered"
]);

export const SemaphoreSchema = z.union([
  z.string(),
  z.object({ name: z.string().min(1), tokens: z.number().int().positive().default(1) }).passthrough()
]);

export const DependenciesSchema = z.object({
  schema: z.literal("kanban-code-agent/dependencies@1").optional(),
  needs: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),
  blockedBy: z.array(z.string()).default([]),
  fileLocks: z.array(z.string()).default([]),
  semaphores: z.array(SemaphoreSchema).default([])
}).passthrough();

export const WorktreeSchema = z.object({
  schema: z.literal("kanban-code-agent/worktree@1").optional(),
  taskId: z.string().optional(),
  enabled: z.boolean().optional(),
  kind: z.string().optional(),
  branch: z.string().min(1),
  pathRef: z.string().optional(),
  path: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  mergeTarget: z.string().optional()
}).passthrough();

export const SubtasksSchema = z.object({
  schema: z.literal("kanban-code-agent/subtasks@1"),
  taskId: z.string().min(1).optional(),
  parentTaskId: z.string().min(1).optional(),
  strategy: z.string().optional(),
  mergePolicy: z.string().optional(),
  subtasks: z.array(z.object({
    id: z.string().min(1),
    title: z.string().optional(),
    status: z.string().optional(),
    agent: z.string().nullable().optional(),
    needs: z.array(z.string()).default([]),
    provides: z.array(z.string()).default([]),
    fileLocks: z.array(z.string()).default([])
  }).passthrough()).default([])
}).passthrough();

export const EventSchema = z.object({
  ts: z.string().min(1),
  type: EventType,
  actor: z.string().min(1),
  taskId: z.string().optional()
}).passthrough();

export const AppSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/app@1"),
  storageRoot: z.string().optional(),
  runtimeRoot: z.string().min(1),
  boardId: z.string().default("default"),
  workspace: z.object({ name: z.string().min(1), language: z.string().min(1).default("pt-BR") }).passthrough(),
  persistence: z.object({ taskStateFormat: z.literal("yaml"), contextFormat: z.literal("markdown"), eventsFormat: z.literal("jsonl") }).passthrough(),
  runtime: z.object({ maxParallelTasks: z.number().int().positive(), agentTokens: z.record(z.string(), z.number().int().nonnegative()).default({}) }).passthrough(),
  manualMove: z.object({ confirmWhenRunning: z.boolean().optional(), defaultInterruptPolicy: z.string().optional() }).passthrough(),
  ui: z.object({ theme: z.string().optional(), density: z.string().optional() }).passthrough(),
  safety: z.object({ requireApprovalForMerge: z.boolean().optional(), requireApprovalForDelete: z.boolean().optional(), allowShell: z.boolean().optional(), allowNetwork: z.boolean().optional() }).passthrough()
}).passthrough();

export const BoardSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/board@1"),
  id: z.string().min(1),
  name: z.string().optional(),
  columns: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    agent: z.string().nullable().optional(),
    autoStart: z.boolean().optional(),
    wip: z.number().int().positive().nullable().optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
    hooks: z.any().optional()
  }).passthrough())
}).passthrough();

export const ProjectSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/project@1"),
  id: z.string().min(1),
  label: z.string().optional(),
  name: z.string().optional(),
  repoPath: z.string().min(1),
  enabled: z.boolean().default(true),
  commands: z.record(z.string(), z.string()).optional(),
  worktrees: z.object({ root: z.string().optional(), branchPrefix: z.string().optional(), cleanup: z.string().optional() }).passthrough().optional(),
  trust: z.object({ allowShell: z.boolean().optional(), allowNetwork: z.boolean().optional() }).passthrough().optional()
}).passthrough();

export const AgentSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/agent@1"),
  id: z.string().min(1),
  label: z.string().optional(),
  provider: z.string().min(1),
  instructionsPath: z.string().optional(),
  instructions: z.any().optional(),
  skills: z.array(z.string()).default([]),
  tools: z.union([z.array(z.string()), z.object({ builtin: z.array(z.string()).default([]), custom: z.array(z.string()).default([]) }).passthrough()]).default([]),
  limits: z.object({ tokens: z.number().int().nonnegative().optional() }).passthrough().optional()
}).passthrough();

export const HookSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/hook@1"),
  id: z.string().min(1),
  label: z.string().optional(),
  kind: z.string().min(1),
  agent: z.string().optional(),
  trigger: z.string().min(1),
  inputs: z.any().optional(),
  outputs: z.any().optional(),
  timeoutMs: z.number().int().positive().optional()
}).passthrough();

export const SkillSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/skill@1"),
  id: z.string().min(1),
  instructionsPath: z.string().optional()
}).passthrough();

export const TaskSchema = z.object({
  schema: z.literal("kanban-code-agent/task@1"),
  id: z.string().min(1),
  title: z.string().min(1),
  kind: TaskKind,
  column: z.string().min(1),
  status: TaskStatus,
  priority: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  projectTargets: z.array(z.string()),
  routing: z.object({
    currentAgent: z.string().nullable().optional(),
    lastAgent: z.string().nullable().optional(),
    nextSuggestedColumn: z.string().nullable().optional(),
    manualOverride: z.object({
      active: z.boolean().default(false),
      lastManualMoveAt: z.string().nullable().optional(),
      invalidatesRunId: z.string().nullable().optional()
    }).partial().optional()
  }).passthrough(),
  worktree: z.object({
    enabled: z.boolean(),
    kind: z.string(),
    branch: z.string(),
    pathRef: z.string().optional(),
    parentTaskId: z.string().nullable().optional(),
    mergeTarget: z.string().optional()
  }).passthrough(),
  dependencies: DependenciesSchema.omit({ schema: true }),
  hooks: z.object({ active: z.array(z.string()).default([]) }).passthrough(),
  skills: z.object({ active: z.array(z.string()).default([]) }).passthrough(),
  tags: z.array(z.string()).default([])
}).passthrough();

const commandBase = z.object({ commandId: z.string().min(1) });

export const CommandSchema = z.discriminatedUnion("type", [
  commandBase.extend({
    type: z.literal("task.create"),
    input: z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      projectTargets: z.array(z.string()).default([]),
      kind: TaskKind.default("task"),
      column: z.string().default("inbox")
    }).passthrough()
  }),
  commandBase.extend({
    type: z.literal("task.update"),
    taskId: z.string().min(1),
    patch: z.record(z.string(), z.any())
  }),
  commandBase.extend({
    type: z.literal("task.move"),
    taskId: z.string().min(1),
    toColumn: z.string().min(1),
    mode: z.enum(["hard", "soft", "after_checkpoint"]).optional()
  }),
  commandBase.extend({
    type: z.literal("task.run"),
    taskId: z.string().min(1),
    agentId: z.string().optional()
  }),
  commandBase.extend({
    type: z.literal("task.interrupt"),
    taskId: z.string().min(1),
    mode: z.enum(["soft", "hard"]).default("soft")
  }),
  commandBase.extend({
    type: z.literal("task.decompose"),
    taskId: z.string().min(1),
    subtasks: z.array(z.object({
      id: z.string().optional(),
      title: z.string().min(1),
      needs: z.array(z.string()).default([]),
      provides: z.array(z.string()).default([]),
      fileLocks: z.array(z.string()).default([]),
      agentId: z.string().optional()
    }).passthrough()).optional()
  }),
  commandBase.extend({
    type: z.literal("task.merge"),
    taskId: z.string().min(1),
    parentPath: z.string().min(1).optional(),
    subtaskBranch: z.string().min(1).optional()
  }),
  commandBase.extend({
    type: z.literal("agent.complete_task"),
    taskId: z.string().min(1),
    runId: z.string().min(1),
    nextColumn: z.string().default("validate"),
    summary: z.string().default("")
  }),
  commandBase.extend({
    type: z.literal("agent.report_blocker"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    blocker: z.string().min(1)
  }),
  commandBase.extend({
    type: z.literal("agent.request_user_input"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    question: z.string().min(1)
  }),
  commandBase.extend({
    type: z.literal("agent.emit_artifact"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    path: z.string().min(1),
    content: z.string().default("")
  }),
  commandBase.extend({
    type: z.literal("agent.chat"),
    agentId: z.string().default("assistant"),
    scope: z.enum(["board", "task"]).default("board"),
    taskId: z.string().optional(),
    prompt: z.string().min(1),
    selectedTaskId: z.string().optional()
  }),
  commandBase.extend({
    type: z.literal("settings.update"),
    scope: z.string().default("app"),
    patch: z.record(z.string(), z.any())
  })
]);

export const QuerySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("board.snapshot") }),
  z.object({ type: z.literal("orchestrator.status") }),
  z.object({ type: z.literal("task.detail"), taskId: z.string().min(1) }),
  z.object({ type: z.literal("settings.scope"), scope: z.string().default("app") }),
  z.object({ type: z.literal("why_not_running"), taskId: z.string().min(1) })
]);

export function parseCommand(input) {
  return CommandSchema.parse(input);
}

export function parseQuery(input) {
  return QuerySchema.parse(input);
}

export function parseEvent(input) {
  return EventSchema.parse(input);
}
