import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const metadataFile = ".kca-worktree.json";

export async function isGitAvailable() {
  try {
    await exec("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd, args, options = {}) {
  return exec("git", args, { cwd, ...options });
}

function requireString(value, name) {
  if (!value || typeof value !== "string") throw new Error(`${name} is required`);
  return value;
}

function safeSegment(value, name) {
  const segment = requireString(value, name);
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) throw new Error(`${name} contains unsupported characters`);
  return segment;
}

async function repoTopLevel(repoPath) {
  const { stdout } = await git(repoPath, ["rev-parse", "--show-toplevel"]);
  return realpath(stdout.trim());
}

async function currentBranch(repoPath) {
  const { stdout } = await git(repoPath, ["branch", "--show-current"]);
  return stdout.trim();
}

export async function createRepoFixture({ root, name = "repo" }) {
  if (!(await isGitAvailable())) return { ok: false, status: "skipped", reason: "git_unavailable" };
  const repoPath = join(requireString(root, "root"), safeSegment(name, "name"));
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "kca@example.test"]);
  await git(repoPath, ["config", "user.name", "KCA Test"]);
  await writeFile(join(repoPath, "README.md"), "fixture\n");
  await git(repoPath, ["add", "README.md"]);
  await git(repoPath, ["commit", "-m", "initial fixture"]);
  return { ok: true, status: "ready", repoPath };
}

export async function createWorktree({ repoPath, taskId, branch, root }) {
  if (!(await isGitAvailable())) return { ok: false, status: "skipped", reason: "git_unavailable" };
  const parentPath = await repoTopLevel(requireString(repoPath, "repoPath"));
  const parentBranch = await currentBranch(parentPath);
  if (!parentBranch) throw new Error("repoPath must be on a branch");

  const worktreeRoot = root ? resolve(root) : join(parentPath, "..", "_worktrees");
  const worktreePath = join(worktreeRoot, safeSegment(taskId, "taskId"));
  await mkdir(worktreeRoot, { recursive: true });
  await git(parentPath, ["worktree", "add", "-b", requireString(branch, "branch"), worktreePath, "HEAD"]);
  await git(parentPath, ["config", `branch.${branch}.kca-parent-path`, parentPath]);
  await git(parentPath, ["config", `branch.${branch}.kca-parent-branch`, parentBranch]);

  const metadata = {
    taskId,
    branch,
    repoPath: parentPath,
    parentPath,
    parentBranch,
    worktreePath,
    createdAt: new Date().toISOString()
  };
  await writeFile(join(worktreePath, metadataFile), `${JSON.stringify(metadata, null, 2)}\n`);
  return { ok: true, status: "created", ...metadata };
}

export async function createParentAndChildWorktrees({ repoPath, parentTaskId, parentBranch, childTaskId, childBranch, root }) {
  const parent = await createWorktree({ repoPath, taskId: parentTaskId, branch: parentBranch, root });
  if (!parent.ok) return { ok: false, status: parent.status, parent };
  const child = await createWorktree({ repoPath: parent.worktreePath, taskId: childTaskId, branch: childBranch, root });
  return { ok: child.ok, status: child.status, parent, child };
}

export async function readWorktreeMetadata(worktreePath) {
  return JSON.parse(await readFile(join(requireString(worktreePath, "worktreePath"), metadataFile), "utf8"));
}

export async function worktreeStatusSummary(worktreePath) {
  if (!(await isGitAvailable())) return { ok: false, status: "skipped", reason: "git_unavailable" };
  const cwd = requireString(worktreePath, "worktreePath");
  const branch = await currentBranch(cwd);
  const { stdout: statusStdout } = await git(cwd, ["status", "--short"]);
  const { stdout: diffStat } = await git(cwd, ["diff", "--stat"]);
  const entries = statusStdout.trim().split("\n").filter(Boolean);
  return {
    ok: true,
    branch,
    dirty: entries.length > 0,
    entries,
    diffStat: diffStat.trim()
  };
}

async function branchConfig(parentPath, branch, key) {
  try {
    const { stdout } = await git(parentPath, ["config", "--get", `branch.${branch}.${key}`]);
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function mergeSubtask({ parentPath, subtaskBranch }) {
  if (!(await isGitAvailable())) return { ok: false, status: "skipped", reason: "git_unavailable" };
  const parentTop = await repoTopLevel(requireString(parentPath, "parentPath"));
  const parentBranch = await currentBranch(parentTop);
  const expectedParentPath = await branchConfig(parentTop, requireString(subtaskBranch, "subtaskBranch"), "kca-parent-path");
  const expectedParentBranch = await branchConfig(parentTop, subtaskBranch, "kca-parent-branch");

  if (!expectedParentPath || await realpath(expectedParentPath) !== parentTop || expectedParentBranch !== parentBranch) {
    return { ok: false, status: "blocked", reason: "invalid_parent", conflict: false };
  }

  try {
    const { stdout, stderr } = await git(parentTop, ["merge", "--no-ff", "--no-edit", subtaskBranch]);
    return { ok: true, status: "merged", stdout, stderr };
  } catch (error) {
    const output = `${error.stdout || ""}\n${error.stderr || ""}`;
    if (/CONFLICT|Automatic merge failed|Merge conflict/i.test(output)) {
      return { ok: false, status: "blocked", reason: "conflict", conflict: true, stdout: error.stdout || "", stderr: error.stderr || "" };
    }
    throw error;
  }
}
