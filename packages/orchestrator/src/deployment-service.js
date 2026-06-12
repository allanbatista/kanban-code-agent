import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function runDeployment({ taskId, command, args = [], cwd, rollback = "" }) {
  const startedAt = new Date().toISOString();
  const result = await exec(command, args, { cwd });
  return {
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
}
