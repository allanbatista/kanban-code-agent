import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { appendJsonl, paths, readHook, writeTaskFile } from "@kca/fsdb";
import { logStep } from "@kca/core/log";

const execFile = promisify(execFileCallback);

async function executeHookAction(config, task, root, hook, p) {
  const kind = config?.kind || "noop";
  if (!["command", "script"].includes(kind)) return null;
  logStep("hook-service", "hook.execute.start", { taskId: task.id, hook, kind });
  const spec = kind === "script" ? config.script : config.command;
  const command = typeof spec === "string" ? spec : spec?.command || spec?.bin || spec?.path;
  const args = typeof spec === "object" && Array.isArray(spec.args) ? spec.args : Array.isArray(config.args) ? config.args : [];
  if (!command) throw new Error(`hook_${kind}_missing_command`);
  const { stdout, stderr } = await execFile(command, args, {
    cwd: config.cwd || (typeof spec === "object" ? spec.cwd : null) || p.root,
    timeout: config.timeoutMs || 120000,
    maxBuffer: 128 * 1024,
    env: { ...process.env, KCA_TASK_ID: task.id, KCA_HOOK_ID: hook, KCA_STORAGE_ROOT: p.root }
  });
  logStep("hook-service", "hook.execute.done", { taskId: task.id, hook, kind });
  return { stdout: String(stdout || "").slice(0, 8192), stderr: String(stderr || "").slice(0, 8192) };
}

export async function runHooks(task, root, trigger) {
  const hooks = task.hooks?.active || [];
  const p = paths(root);
  const events = [];
  logStep("hook-service", "hooks.start", { taskId: task.id, trigger, count: hooks.length });
  for (const hook of hooks) {
    const config = await readHook(hook, root);
    const started = { ts: new Date().toISOString(), type: "hook.started", actor: "orchestrator", taskId: task.id, hook, trigger, kind: config?.kind || "noop" };
    await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, started);
    events.push(started);
    try {
      const action = await executeHookAction(config, task, root, hook, p);
      if (config?.outputs?.writeSummaryTo) {
        const body = action ? `\n\n## stdout\n\n${action.stdout || "(vazio)"}\n\n## stderr\n\n${action.stderr || "(vazio)"}\n` : "\n";
        await writeTaskFile(task.id, config.outputs.writeSummaryTo, `# ${config.label || hook}\n\nHook ${hook} executado em ${started.ts} para ${task.id}.${body}`, root);
      }
      if (config?.outputs?.emitArtifact) {
        await writeTaskFile(task.id, config.outputs.emitArtifact, action ? `${action.stdout}${action.stderr ? `\n${action.stderr}` : ""}` : `Hook ${hook} executado em ${started.ts}.\n`, root);
      }
      const completed = { ts: new Date().toISOString(), type: "hook.completed", actor: "hook", taskId: task.id, hook, trigger, kind: config?.kind || "noop", stdout: action?.stdout, stderr: action?.stderr };
      await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, completed);
      events.push(completed);
    } catch (error) {
      const failed = { ts: new Date().toISOString(), type: "hook.failed", actor: "hook", taskId: task.id, hook, trigger, error: error.message };
      await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, failed);
      events.push(failed);
    }
  }
  logStep("hook-service", "hooks.done", { taskId: task.id, trigger, count: hooks.length });
  return events;
}
