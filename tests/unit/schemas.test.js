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
  RoleSettingsSchema,
  SemaphoreStateSchema,
  SkillSettingsSchema,
  SubtasksSchema,
  TaskSchema,
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

  assert.equal(AppSettingsSchema.parse(await readYamlFile(join(root, "settings", "app.yaml"))).schema, "kanban-code-agent/app@1");
  assert.equal(BoardSettingsSchema.parse(await readYamlFile(join(root, "settings", "boards", "default.yaml"))).columns.length, 12);
  assert.equal(ProjectSettingsSchema.parse(await readYamlFile(join(root, "settings", "projects", "kanban-code-agent.yaml"))).id, "kanban-code-agent");
  assert.equal(AgentSettingsSchema.parse(await readYamlFile(join(root, "settings", "agents", "engineering.yaml"))).provider, "pi");
  const role = RoleSettingsSchema.parse(await readYamlFile(join(root, "settings", "roles", "engineering.yaml")));
  assert.equal(role.id, "engineering");
  assert.equal(role.scope, "task");
  assert.equal(role.promptPath, "../prompts/engineering.md");
  const generalist = RoleSettingsSchema.parse(await readYamlFile(join(root, "settings", "roles", "generalist.yaml")));
  assert.equal(generalist.id, "generalist");
  assert.equal(HookSettingsSchema.parse(await readYamlFile(join(root, "settings", "hooks", "summarize-blocker.yaml"))).id, "summarize-blocker");
  assert.equal(SkillSettingsSchema.parse(await readYamlFile(join(root, "settings", "skills", "implementation.yaml"))).id, "implementation");
  assert.equal(SemaphoreStateSchema.parse(await readYamlFile(join(root, "settings", "runtime", "semaphores.yaml"))).tokens["global:tasks"], 4);
  assert.match(await readFile(join(root, "settings", "skills", "implementation", "SKILL.md"), "utf8"), /Implementation Skill/);

  assert.equal(TaskSchema.parse(await readYamlFile(join(root, "tasks", task.id, "task.yaml"))).id, task.id);
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
