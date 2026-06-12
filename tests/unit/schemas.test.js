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
  AppSettingsSchema,
  BoardSettingsSchema,
  DependenciesSchema,
  EventSchema,
  HookSettingsSchema,
  ProjectSettingsSchema,
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
  assert.equal(BoardSettingsSchema.parse(await readYamlFile(join(root, "settings", "boards", "default.yaml"))).columns.length, 6);
  assert.equal(ProjectSettingsSchema.parse(await readYamlFile(join(root, "settings", "projects", "kanban-code-agent.yaml"))).id, "kanban-code-agent");
  assert.equal(AgentSettingsSchema.parse(await readYamlFile(join(root, "settings", "agents", "engineer.yaml"))).provider, "pi");
  assert.equal(HookSettingsSchema.parse(await readYamlFile(join(root, "settings", "hooks", "summarize-blocker.yaml"))).id, "summarize-blocker");
  assert.equal(SkillSettingsSchema.parse(await readYamlFile(join(root, "settings", "skills", "implementation.yaml"))).id, "implementation");
  assert.match(await readFile(join(root, "settings", "skills", "implementation", "SKILL.md"), "utf8"), /Implementation Skill/);

  assert.equal(TaskSchema.parse(await readYamlFile(join(root, "tasks", task.id, "task.yaml"))).id, task.id);
  assert.equal(DependenciesSchema.parse(await readYamlFile(join(root, "tasks", task.id, "dependencies.yaml"))).needs.length, 0);
  assert.equal(WorktreeSchema.parse(await readYamlFile(join(root, "tasks", task.id, "worktree.yaml"))).branch, task.worktree.branch);
  assert.equal(SubtasksSchema.parse(await readYamlFile(join(root, "tasks", task.id, "subtasks.yaml"))).taskId, task.id);

  const events = (await readFile(join(root, "tasks", task.id, "events.jsonl"), "utf8")).trim().split("\n").map((line) => EventSchema.parse(JSON.parse(line)));
  assert.equal(events[0].type, "task.created");
});
