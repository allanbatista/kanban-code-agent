import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import {
  AgentSettingsSchema,
  AgentRunSchema,
  AppSettingsSchema,
  BoardSettingsSchema,
  DependenciesSchema,
  EventSchema,
  HookSettingsSchema,
  PlanningSchema,
  ProjectSettingsSchema,
  parseCommand,
  RoleSettingsSchema,
  SemaphoreStateSchema,
  SkillSettingsSchema,
  SubtasksSchema,
  TaskSchema,
  TaskWorkflowSchema,
  WorktreeSchema
} from "../../packages/schemas/src/index.js";

const exec = promisify(execFile);
const cli = join(process.cwd(), "apps/cli/src/kca.js");

async function readYamlFile(path) {
  return YAML.parse(await readFile(path, "utf8"));
}

test("schemas parse generated FSDB settings, task files and events", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-schema-"));
  await exec(process.execPath, [cli, "init"], { env: { ...process.env, KCA_STORAGE_ROOT: root } });
  await exec(process.execPath, [cli, "project", "add", "--id", "kanban-code-agent", "--repo", process.cwd()], { env: { ...process.env, KCA_STORAGE_ROOT: root } });
  const { stdout } = await exec(process.execPath, [cli, "task", "create", "--title", "Validar schemas", "--project", "kanban-code-agent"], { env: { ...process.env, KCA_STORAGE_ROOT: root } });
  const task = JSON.parse(stdout);

  const appSettings = AppSettingsSchema.parse(await readYamlFile(join(root, "settings", "app.yaml")));
  assert.equal(appSettings.schema, "kanban-code-agent/app@1");
  assert.equal(appSettings.workflow.requireTechnicalPlanForCode, true);
  assert.equal(appSettings.workflow.sandboxPolicy, "prompt_only");
  assert.equal(AppSettingsSchema.parse({ ...appSettings, ai: { ...appSettings.ai, defaultEffort: "xhigh" } }).ai.defaultEffort, "xhigh");
  assert.equal(AgentSettingsSchema.parse({ schema: "kanban-code-agent/agent@1", id: "legacy", label: "Legacy", provider: "inherit", model: { effort: "minimal" } }).model.effort, "minimal");
  assert.equal(BoardSettingsSchema.parse(await readYamlFile(join(root, "settings", "boards", "default.yaml"))).columns.length, 11);
  assert.equal(ProjectSettingsSchema.parse(await readYamlFile(join(root, "settings", "projects", "kanban-code-agent.yaml"))).id, "kanban-code-agent");
  const engineeringAgent = AgentSettingsSchema.parse(await readYamlFile(join(root, "settings", "agents", "engineering.yaml")));
  assert.equal(engineeringAgent.provider, "inherit");
  assert.equal(engineeringAgent.limits.maxParallelTasks, 50);
  const role = RoleSettingsSchema.parse(await readYamlFile(join(root, "settings", "roles", "engineering.yaml")));
  assert.equal(role.id, "engineering");
  assert.equal(role.scope, "task");
  assert.equal(role.promptPath, "../prompts/engineering.md");
  const generalist = RoleSettingsSchema.parse(await readYamlFile(join(root, "settings", "roles", "generalist.yaml")));
  assert.equal(generalist.id, "generalist");
  assert.equal(HookSettingsSchema.parse(await readYamlFile(join(root, "settings", "hooks", "summarize-blocker.yaml"))).id, "summarize-blocker");
  assert.equal(SkillSettingsSchema.parse(await readYamlFile(join(root, "settings", "skills", "implementation.yaml"))).id, "implementation");
  assert.equal(SemaphoreStateSchema.parse(await readYamlFile(join(root, "settings", "runtime", "semaphores.yaml"))).tokens["global:tasks"], 1000);
  assert.match(await readFile(join(root, "settings", "skills", "implementation", "SKILL.md"), "utf8"), /Implementation Skill/);

  const parsedTask = TaskSchema.parse(await readYamlFile(join(root, "tasks", task.id, "task.yaml")));
  assert.equal(parsedTask.id, task.id);
  assert.equal(parsedTask.rootTaskId, task.id);
  assert.equal(parsedTask.depth, 0);
  assert.equal(TaskWorkflowSchema.parse(parsedTask.workflow).gates.definitionOfReady.status, "pending");
  assert.equal(TaskWorkflowSchema.parse(parsedTask.workflow).artifacts.technicalPlan, "technical-plan.md");
  assert.match(await readFile(join(root, "tasks", task.id, "task-spec.md"), "utf8"), /# Task Spec/);
  const planning = PlanningSchema.parse(await readYamlFile(join(root, "tasks", task.id, "planning.yaml")));
  assert.equal(planning.roles.required.includes("architecture"), true);
  assert.equal(planning.roles.required.includes("deployment"), true);
  assert.equal(DependenciesSchema.parse(await readYamlFile(join(root, "tasks", task.id, "dependencies.yaml"))).needs.length, 0);
  assert.equal(WorktreeSchema.parse(await readYamlFile(join(root, "tasks", task.id, "worktree.yaml"))).branch, task.worktree.branch);
  assert.equal(SubtasksSchema.parse(await readYamlFile(join(root, "tasks", task.id, "subtasks.yaml"))).taskId, task.id);
  assert.equal(AgentRunSchema.parse({ schema: "kanban-code-agent/agent-run@1", runId: "run-1", taskId: task.id, agentId: "engineering", role: "engineering", allowedTools: ["complete_task"] }).role, "engineering");

  const events = (await readFile(join(root, "tasks", task.id, "events.jsonl"), "utf8")).trim().split("\n").map((line) => EventSchema.parse(JSON.parse(line)));
  assert.equal(events[0].type, "task.created");
});

test("task.decompose command requires explicit agent-owned subtasks", () => {
  assert.throws(() => parseCommand({ type: "scheduler.tick", commandId: "cmd-old-scheduler" }));
  assert.throws(() => parseCommand({
    type: "task.decompose",
    commandId: "cmd-empty-decompose",
    taskId: "KCA-SCHEMA",
    subtasks: []
  }));
  assert.throws(() => parseCommand({
    type: "task.decompose",
    commandId: "cmd-roleless-decompose",
    taskId: "KCA-SCHEMA",
    subtasks: [{ title: "Roleless" }]
  }));
  assert.equal(parseCommand({
    type: "task.decompose",
    commandId: "cmd-default-decompose",
    taskId: "KCA-SCHEMA"
  }).subtasks, undefined);
  const parsed = parseCommand({
    type: "task.decompose",
    commandId: "cmd-valid-decompose",
    taskId: "KCA-SCHEMA",
    subtasks: [{ title: "Implement", role: "engineering" }]
  });
  assert.equal(parsed.subtasks[0].role, "engineering");
  assert.equal(parseCommand({ type: "task.pause", commandId: "cmd-pause", taskId: "KCA-SCHEMA", scope: "chain" }).scope, "chain");
  assert.equal(parseCommand({ type: "task.resume", commandId: "cmd-resume", taskId: "KCA-SCHEMA" }).scope, "task");
  assert.equal(parseCommand({ type: "task.cancel", commandId: "cmd-cancel", taskId: "KCA-SCHEMA", reason: "stop" }).scope, "task");
  assert.equal(parseCommand({ type: "subtask.review", commandId: "cmd-review", taskId: "KCA-CHILD", decision: "approve" }).decision, "approve");
  assert.equal(parseCommand({ type: "subtask.answer_question", commandId: "cmd-answer", taskId: "KCA-CHILD", answer: "ok" }).answer, "ok");
});
