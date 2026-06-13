#!/usr/bin/env node
import { addProject, createTask, initStorage, listTasks, moveTask, rebuildIndexes, rebuildTaskFromEvents } from "@kca/fsdb";
import { handleCommand, handleQuery } from "@kca/orchestrator";
import { doctorPi } from "@kca/pi-adapter";

const args = process.argv.slice(2);

function value(flag, fallback = undefined) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
}

function values(flag) {
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}

function root() {
  return value("--root", process.env.KCA_STORAGE_ROOT);
}

function requireValue(name, current) {
  if (!current) {
    console.error(`Missing ${name}`);
    process.exit(2);
  }
  return current;
}

async function main() {
  const [scope, action, positional] = args;
  if (!scope || scope === "help" || scope === "--help") {
    console.log("Usage: kca init|doctor|task create|task move|task recover|task run|task interrupt|task decompose|task list|project add");
    return;
  }

  if (scope === "init") {
    const p = await initStorage(root());
    console.log(`Initialized ${p.root}`);
    return;
  }

  if (scope === "doctor") {
    const p = await initStorage(root());
    const tasks = await listTasks(root());
    const indexes = await rebuildIndexes(root());
    const pi = await doctorPi({
      cwd: process.cwd(),
      sessionDir: `${p.runtime}/sessions/pi-doctor`,
      runPrompt: args.includes("--pi-smoke") || process.env.KCA_PI_RUN_PROMPT === "1"
    });
    console.log(JSON.stringify({ ok: true, root: p.root, tasks: tasks.length, indexes, pi }, null, 2));
    return;
  }

  if (scope === "project" && action === "add") {
    const project = await addProject({
      id: requireValue("--id", value("--id")),
      label: value("--label"),
      repo: requireValue("--repo", value("--repo"))
    }, root());
    console.log(JSON.stringify(project, null, 2));
    return;
  }

  if (scope === "task" && action === "create") {
    const task = await createTask({
      title: requireValue("--title", value("--title")),
      description: value("--description", ""),
      projectTargets: values("--project"),
      kind: value("--kind", "task"),
      column: value("--column", "manager")
    }, root());
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (scope === "task" && action === "move") {
    const taskId = requireValue("taskId", positional);
    const toColumn = requireValue("column", args[3]);
    const task = await moveTask(taskId, toColumn, root());
    console.log(JSON.stringify(task, null, 2));
    return;
  }

  if (scope === "task" && action === "run") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await handleCommand({ type: "task.run", commandId: value("--command-id", `cli-run-${Date.now()}`), taskId, agentId: value("--agent") }, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "recover") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await rebuildTaskFromEvents(taskId, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "interrupt") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await handleCommand({ type: "task.interrupt", commandId: value("--command-id", `cli-interrupt-${Date.now()}`), taskId, mode: value("--mode", "soft") }, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "decompose") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await handleCommand({ type: "task.decompose", commandId: value("--command-id", `cli-decompose-${Date.now()}`), taskId }, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "merge") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await handleCommand({ type: "task.merge", commandId: value("--command-id", `cli-merge-${Date.now()}`), taskId, parentPath: value("--parent-path"), subtaskBranch: value("--branch") }, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "why") {
    const taskId = requireValue("taskId", positional);
    console.log(JSON.stringify(await handleQuery({ type: "why_not_running", taskId }, root()), null, 2));
    return;
  }

  if (scope === "task" && action === "list") {
    console.log(JSON.stringify(await listTasks(root()), null, 2));
    return;
  }

  console.error(`Unknown command: ${args.join(" ")}`);
  process.exit(2);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
