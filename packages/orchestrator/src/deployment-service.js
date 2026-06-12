import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logStep } from "@kca/core/log";

const exec = promisify(execFile);

export async function runDeployment({ taskId, command, args = [], cwd, rollback = "" }) {
  const startedAt = new Date().toISOString();
  logStep("orchestrator", "deployment.start", { taskId, command });
  const result = await exec(command, args, { cwd });
  const output = {
    schema: "kanban-code-agent/deployment@1",
    taskId,
    command,
    args,
    status: "released",
    startedAt,
    completedAt: new Date().toISOString(),
    stdout: result.stdout,
    stderr: result.stderr,
    rollback
  };
  logStep("orchestrator", "deployment.done", { taskId, command });
  return output;
}
