import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const cli = join(process.cwd(), "apps/cli/src/kca.js");

async function run(args, root) {
  return exec(process.execPath, [cli, ...args], { env: { ...process.env, KCA_STORAGE_ROOT: root } });
}

test("kca init creates open storage tree and ignores runtime data", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-"));
  await run(["init"], root);
  const gitignore = await readFile(join(root, ".gitignore"), "utf8");
  assert.match(await readFile(join(root, "settings/app.yaml"), "utf8"), /taskStateFormat: yaml/);
  assert.match(gitignore, /settings\/runtime\/sessions\//);
  assert.match(gitignore, /_worktrees\//);
});

test("kca project add and task create persist YAML, Markdown and JSONL", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-"));
  await run(["project", "add", "--id", "kanban-code-agent", "--repo", process.cwd()], root);
  const { stdout } = await run(["task", "create", "--title", "Implementar FSDB", "--description", "Persistir formatos abertos.", "--project", "kanban-code-agent"], root);
  const task = JSON.parse(stdout);
  assert.equal(task.projectTargets[0], "kanban-code-agent");
  assert.match(await readFile(join(root, "tasks", task.id, "task.yaml"), "utf8"), /schema: kanban-code-agent\/task@1/);
  assert.match(await readFile(join(root, "tasks", task.id, "description.md"), "utf8"), /Persistir formatos abertos/);
  assert.match(await readFile(join(root, "tasks", task.id, "subtasks.yaml"), "utf8"), /schema: kanban-code-agent\/subtasks@1/);
  assert.match(await readFile(join(root, "tasks", task.id, "comments.jsonl"), "utf8"), /comment.system/);
  assert.match(await readFile(join(root, "tasks", task.id, "events.jsonl"), "utf8"), /task.created/);
});

test("kca task move updates materialized YAML and appends event", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-"));
  const { stdout } = await run(["task", "create", "--title", "Mover task"], root);
  const task = JSON.parse(stdout);
  await run(["task", "move", task.id, "build"], root);
  assert.match(await readFile(join(root, "tasks", task.id, "task.yaml"), "utf8"), /column: build/);
  assert.match(await readFile(join(root, "tasks", task.id, "events.jsonl"), "utf8"), /task.moved/);
});

test("kca task recover rebuilds materialized YAML from append-only events", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-"));
  const { stdout } = await run(["task", "create", "--title", "Recuperar task"], root);
  const task = JSON.parse(stdout);
  await run(["task", "move", task.id, "build"], root);
  const taskPath = join(root, "tasks", task.id, "task.yaml");
  const corrupted = (await readFile(taskPath, "utf8")).replace("column: build", "column: blocked").replace("status: idle", "status: blocked");
  await writeFile(taskPath, corrupted);

  const recovered = JSON.parse((await run(["task", "recover", task.id], root)).stdout);
  assert.equal(recovered.column, "build");
  assert.equal(recovered.status, "idle");
  assert.match(await readFile(join(root, "tasks", task.id, "events.jsonl"), "utf8"), /task.recovered/);
});

test("kca task run interrupt decompose and why use orchestrator commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-"));
  const { stdout } = await run(["task", "create", "--title", "CLI runtime", "--kind", "master"], root);
  const task = JSON.parse(stdout);
  const runResult = JSON.parse((await run(["task", "run", task.id, "--agent", "engineer"], root)).stdout);
  assert.equal(runResult.task.status, "running");

  const interruptResult = JSON.parse((await run(["task", "interrupt", task.id, "--mode", "hard"], root)).stdout);
  assert.equal(interruptResult.task.status, "idle");

  const decomposeResult = JSON.parse((await run(["task", "decompose", task.id], root)).stdout);
  assert.equal(decomposeResult.subtasks.length, 2);

  const whyResult = JSON.parse((await run(["task", "why", decomposeResult.subtasks[1].id], root)).stdout);
  assert.equal(whyResult.runnable, false);

  const doctorResult = JSON.parse((await run(["doctor"], root)).stdout);
  assert.equal(doctorResult.indexes.taskCount, 3);
  assert.equal(doctorResult.pi.sdk.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(doctorResult.pi.dryRun.mode, "real");
  assert.match(await readFile(join(root, "settings", "runtime", "indexes", "tasks.json"), "utf8"), /CLI runtime/);
});
