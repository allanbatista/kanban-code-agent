import { z } from "zod";

export const TaskStatus = z.enum(["draft", "idle", "queued", "running", "interrupting", "validating", "waiting", "waiting_human", "blocked", "merge_pending", "done", "failed", "canceled", "paused"]);
export const TaskKind = z.enum(["task", "master", "subtask", "spike", "bug", "chore"]);
export const EventType = z.enum([
  "task.created",
  "task.updated",
  "task.file.updated",
  "task.attachment.created",
  "task.move_requested",
  "task.moved",
  "task.comment",
  "task.blocked",
  "task.problem",
  "task.run.blocked",
  "task.unblocked",
  "task.unassigned",
  "agent.queued",
  "agent.run",
  "agent.started",
  "agent.event",
  "agent.transcript",
  "agent.usage",
  "agent.message",
  "agent.waiting_for_persona",
  "agent.waiting_for_human",
  "agent.checkpoint_requested",
  "agent.interrupted",
  "agent.completed",
  "agent.failed",
  "agent.command",
  "agent.input_requested",
  "role.handoff",
  "human.input_requested",
  "human.input_received",
  "gate.passed",
  "gate.failed",
  "chat.created",
  "chat.compaction_requested",
  "chat.compacted",
  "delegation.requested",
  "delegation.result",
  "provider.missing_env",
  "artifact.emitted",
  "hook.started",
  "hook.completed",
  "hook.failed",
  "scheduler.tick",
  "worktree.created",
  "worktree.updated",
  "worktree.removed",
  "subtasks.spawned",
  "subtask.merged",
  "merge.requested",
  "merge.blocked",
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

export const RoleSettingsSchema = z.object({
  schema: z.literal("kanban-code-agent/role@1"),
  id: z.enum(["manager", "product", "design", "architecture", "generalist", "engineering", "quality", "review", "deployment"]),
  label: z.string().min(1),
  agentId: z.string().min(1),
  scope: z.enum(["board", "task"]).default("task"),
  promptPath: z.string().min(1).optional(),
  columnIds: z.array(z.string().min(1)).default([]),
  tools: z.object({
    builtin: z.array(z.string()).default([]).optional(),
    custom: z.array(z.string()).default([])
  }).passthrough(),
  limits: z.object({ tokens: z.number().int().nonnegative().default(1) }).passthrough(),
  policies: z.object({
    canCreateSubtasks: z.boolean().default(false),
    requiresWorktree: z.boolean().default(false),
    autoStart: z.boolean().default(false)
  }).passthrough(),
  model: z.object({
    provider: z.string().min(1).default("inherit"),
    name: z.string().default(""),
    effort: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
    temperature: z.number().optional()
  }).passthrough().optional(),
  gate: z.string().min(1).optional()
}).passthrough();

export const ProviderId = z.string().min(1);

export const ProviderDiscoverySchema = z.object({
  schema: z.literal("kanban-code-agent/provider-discovery@1"),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  providers: z.array(z.object({
    id: ProviderId,
    type: z.string().min(1),
    label: z.string().optional(),
    configured: z.boolean(),
    enabled: z.boolean().default(false),
    active: z.boolean().default(false),
    requiredEnv: z.array(z.string()).default([]),
    missingEnv: z.array(z.string()).default([]),
    optionalEnv: z.array(z.string()).default([]),
    apiKeyEnv: z.string().optional(),
    baseUrl: z.string().nullable().optional(),
    modelsEndpoint: z.string().nullable().optional(),
    defaultModel: z.string().optional(),
    contextSource: z.string().optional()
  }).passthrough())
});

export const PersonaMessageSchema = z.object({
  scope: z.enum(["board", "task"]),
  taskId: z.string().optional(),
  persona: z.string().min(1),
  agentId: z.string().optional(),
  runId: z.string().optional(),
  text: z.string().default(""),
  visibility: z.enum(["chat", "timeline", "both"]).default("chat")
}).passthrough();

export const AgentStepDispositionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue_running") }),
  z.object({ type: z.literal("message_and_continue"), message: PersonaMessageSchema }),
  z.object({ type: z.literal("emit_artifact_and_continue"), artifact: z.object({ path: z.string().min(1), content: z.string().default("") }).passthrough(), message: PersonaMessageSchema.optional() }),
  z.object({ type: z.literal("complete_for_persona"), nextRole: z.string().min(1), summary: z.string().default(""), evidence: z.array(z.any()).default([]) }),
  z.object({ type: z.literal("wait_for_persona"), targetRole: z.string().min(1), question: z.string().min(1), expectedArtifact: z.string().optional() }),
  z.object({ type: z.literal("wait_for_human"), question: z.string().min(1), options: z.array(z.string()).optional(), requestedByRole: z.string().min(1).optional() }),
  z.object({ type: z.literal("fail_run"), reason: z.string().min(1), recoverable: z.boolean().default(true) })
]);

export const PlanningSchema = z.object({
  schema: z.literal("kanban-code-agent/planning@1"),
  taskId: z.string().min(1),
  status: z.enum(["draft", "proposed", "approved", "superseded"]).default("draft"),
  createdByRole: z.string().min(1),
  roles: z.object({
    required: z.array(z.string().min(1)).default([]),
    optional: z.array(z.string().min(1)).default([])
  }).passthrough(),
  artifacts: z.object({
    acceptance: z.string().min(1).default("acceptance.md"),
    design: z.string().min(1).optional(),
    technicalPlan: z.string().min(1).optional()
  }).passthrough()
}).passthrough();

export const SemaphoreStateSchema = z.object({
  schema: z.literal("kanban-code-agent/semaphores@1"),
  tokens: z.record(z.string(), z.number().int().nonnegative()).default({}),
  leases: z.array(z.object({
    name: z.string().min(1),
    leaseId: z.string().min(1),
    runId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    acquiredAt: z.string().min(1),
    expiresAt: z.string().min(1).optional()
  }).passthrough()).default([])
}).passthrough();

export const AgentRunSchema = z.object({
  schema: z.literal("kanban-code-agent/agent-run@1"),
  runId: z.string().min(1),
  taskId: z.string().min(1),
  agentId: z.string().min(1),
  role: z.string().min(1).optional(),
  scope: z.enum(["global", "task", "hook"]).default("task"),
  status: z.enum(["queued", "running", "completed", "failed", "canceled"]).default("queued"),
  sessionRef: z.string().optional(),
  allowedTools: z.array(z.string()).default([])
}).passthrough();

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

const SubtaskNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  status: z.string().optional(),
  column: z.string().optional(),
  role: z.string().optional(),
  agent: z.string().nullable().optional(),
  needs: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),
  fileLocks: z.array(z.string()).default([]),
  semaphores: z.array(SemaphoreSchema).default([])
}).passthrough();

export const SubtasksV1Schema = z.object({
  schema: z.literal("kanban-code-agent/subtasks@1"),
  taskId: z.string().min(1).optional(),
  parentTaskId: z.string().min(1).optional(),
  strategy: z.string().optional(),
  mergePolicy: z.string().optional(),
  subtasks: z.array(SubtaskNodeSchema).default([])
}).passthrough();

export const SubtasksV2Schema = z.object({
  schema: z.literal("kanban-code-agent/subtasks@2"),
  taskId: z.string().min(1).optional(),
  parentTaskId: z.string().min(1),
  strategy: z.literal("dag").default("dag"),
  mergePolicy: z.string().default("sequential-into-parent-feature"),
  nodes: z.array(SubtaskNodeSchema).default([]),
  subtasks: z.array(SubtaskNodeSchema).default([]).optional(),
  edges: z.array(z.object({
    from: z.string().min(1),
    to: z.string().min(1),
    contract: z.string().min(1).optional()
  }).passthrough()).default([])
}).passthrough();

export const SubtasksSchema = z.union([SubtasksV1Schema, SubtasksV2Schema]);

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
  ai: z.object({
    defaultProvider: z.string().default("openai"),
    defaultModel: z.string().default(""),
    defaultEffort: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
    enabledProviders: z.array(z.string()).default([]),
    providers: z.record(z.string(), z.any()).default({})
  }).passthrough().optional(),
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
  model: z.object({
    provider: z.string().min(1).default("inherit"),
    name: z.string().default(""),
    effort: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
    temperature: z.number().optional()
  }).passthrough().optional(),
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
    currentRole: z.string().nullable().optional(),
    lastAgent: z.string().nullable().optional(),
    lastRole: z.string().nullable().optional(),
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
      title: z.string().optional(),
      description: z.string().optional(),
      projectTargets: z.array(z.string()).default([]),
      column: z.string().default("manager"),
      draft: z.boolean().optional()
    }).passthrough()
  }),
  commandBase.extend({
    type: z.literal("agent.step"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    disposition: AgentStepDispositionSchema
  }),
  commandBase.extend({
    type: z.literal("agent.wait_for_persona"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    targetRole: z.string().min(1),
    question: z.string().min(1),
    expectedArtifact: z.string().optional()
  }),
  commandBase.extend({
    type: z.literal("agent.wait_for_human"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    requestedByRole: z.string().min(1).optional()
  }),
  commandBase.extend({
    type: z.literal("agent.message"),
    message: PersonaMessageSchema
  }),
  commandBase.extend({
    type: z.literal("agent.delegate_task"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    fromPersona: z.string().min(1),
    toPersona: z.string().min(1),
    wait: z.boolean().default(false),
    request: z.string().min(1),
    expectedOutput: z.string().optional(),
    closeCurrentWhenDelegated: z.boolean().optional()
  }),
  commandBase.extend({
    type: z.literal("chat.compact"),
    taskId: z.string().min(1),
    persona: z.string().min(1).default("assistant"),
    summary: z.string().default(""),
    tokenStats: z.record(z.string(), z.any()).default({})
  }),
  commandBase.extend({
    type: z.literal("chat.reset_board"),
    agentId: z.string().min(1).default("assistant")
  }),
  commandBase.extend({
    type: z.literal("agent.review_task"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    findings: z.array(z.object({ severity: z.string().optional(), message: z.string().optional() }).passthrough()).default([]),
    evidence: z.array(z.any()).default([]),
    passColumn: z.string().default("deployment"),
    failRole: z.string().default("engineering")
  }),
  commandBase.extend({
    type: z.literal("agent.deploy_task"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    rollback: z.string().default("")
  }),
  commandBase.extend({
    type: z.literal("task.answer_input"),
    taskId: z.string().min(1),
    answer: z.string().min(1),
    returnRole: z.string().optional()
  }),
  commandBase.extend({
    type: z.literal("task.comment"),
    taskId: z.string().min(1),
    text: z.string().min(1),
    replyToMessageId: z.string().optional()
  }),
  commandBase.extend({
    type: z.literal("role.route_task"),
    taskId: z.string().min(1),
    role: z.string().min(1),
    reason: z.string().default("")
  }),
  commandBase.extend({
    type: z.literal("task.update"),
    taskId: z.string().min(1),
    patch: z.record(z.string(), z.any())
  }),
  commandBase.extend({
    type: z.literal("task.file.write"),
    taskId: z.string().min(1),
    path: z.enum(["acceptance.md", "description.md"]),
    content: z.string().default("")
  }),
  commandBase.extend({
    type: z.literal("task.attachment.write"),
    taskId: z.string().min(1),
    fileName: z.string().min(1),
    contentType: z.string().optional(),
    dataBase64: z.string().min(1)
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
      role: z.string().optional(),
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
    type: z.literal("scheduler.tick"),
    maxStarts: z.number().int().positive().optional()
  }),
  commandBase.extend({
    type: z.literal("agent.complete_task"),
    taskId: z.string().min(1),
    runId: z.string().min(1),
    nextColumn: z.string().default("validate"),
    summary: z.string().default(""),
    finalText: z.string().optional()
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
    type: z.literal("agent.run_command"),
    taskId: z.string().min(1),
    runId: z.string().optional(),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    cwd: z.string().default("worktree"),
    timeoutMs: z.number().int().positive().default(120000)
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
  z.object({ type: z.literal("task.files"), taskId: z.string().min(1) }),
  z.object({ type: z.literal("settings.scope"), scope: z.string().default("app") }),
  z.object({ type: z.literal("chat.history"), scope: z.enum(["board", "task"]).default("board"), taskId: z.string().optional(), persona: z.string().default("assistant"), limit: z.number().int().positive().max(500).default(100) }),
  z.object({ type: z.literal("task.comments"), taskId: z.string().min(1), limit: z.number().int().positive().max(500).default(100) }),
  z.object({ type: z.literal("agent.logs"), taskId: z.string().min(1), limit: z.number().int().positive().max(200).default(50), cursor: z.string().optional(), agentId: z.string().optional(), runId: z.string().optional() }),
  z.object({ type: z.literal("chat.build"), taskId: z.string().min(1), persona: z.string().min(1).default("assistant") }),
  z.object({ type: z.literal("provider.discover") }),
  z.object({ type: z.literal("provider.models"), providerId: z.string().min(1) }),
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
