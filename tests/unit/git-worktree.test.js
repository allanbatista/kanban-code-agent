import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { createRepoFixture, createWorktree, isGitAvailable, mergeSubtask, readWorktreeMetadata, worktreeStatusSummary } from "../../packages/git-worktree/src/index.js";

const exec = promisify(execFile);
const hasGit = await isGitAvailable();

async function git(cwd, args) {
  return exec("git", args, { cwd });
}

test("createWorktree creates git worktree and metadata", { skip: !hasGit && "git unavailable" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-gwt-"));
  const fixture = await createRepoFixture({ root });
  const worktreesRoot = join(root, "_worktrees");
  const worktree = await createWorktree({
    repoPath: fixture.repoPath,
    taskId: "task-1",
    branch: "task/task-1",
    root: worktreesRoot
  });

  assert.equal(worktree.status, "created");
  assert.equal((await git(worktree.worktreePath, ["branch", "--show-current"])).stdout.trim(), "task/task-1");
  assert.equal((await readWorktreeMetadata(worktree.worktreePath)).parentBranch, "main");
  await writeFile(join(worktree.worktreePath, "draft.txt"), "draft\n");
  const status = await worktreeStatusSummary(worktree.worktreePath);
  assert.equal(status.branch, "task/task-1");
  assert.equal(status.dirty, true);
  assert.match(status.entries.join("\n"), /draft.txt/);
});

test("mergeSubtask merges only into recorded parent branch", { skip: !hasGit && "git unavailable" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-gwt-"));
  const fixture = await createRepoFixture({ root });
  const worktree = await createWorktree({
    repoPath: fixture.repoPath,
    taskId: "task-2",
    branch: "task/task-2",
    root: join(root, "_worktrees")
  });

  await writeFile(join(worktree.worktreePath, "feature.txt"), "done\n");
  await git(worktree.worktreePath, ["add", "feature.txt"]);
  await git(worktree.worktreePath, ["commit", "-m", "task change"]);

  await git(fixture.repoPath, ["checkout", "-b", "wrong-target"]);
  assert.equal((await mergeSubtask({ parentPath: fixture.repoPath, subtaskBranch: "task/task-2" })).reason, "invalid_parent");
  await git(fixture.repoPath, ["checkout", "main"]);

  const merged = await mergeSubtask({ parentPath: fixture.repoPath, subtaskBranch: "task/task-2" });
  assert.equal(merged.status, "merged");
  assert.match(await readFile(join(fixture.repoPath, "feature.txt"), "utf8"), /done/);
});

test("mergeSubtask returns blocked conflict instead of throwing raw git errors", { skip: !hasGit && "git unavailable" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-gwt-"));
  const fixture = await createRepoFixture({ root });
  await writeFile(join(fixture.repoPath, "shared.txt"), "base\n");
  await git(fixture.repoPath, ["add", "shared.txt"]);
  await git(fixture.repoPath, ["commit", "-m", "shared base"]);

  const worktree = await createWorktree({
    repoPath: fixture.repoPath,
    taskId: "task-3",
    branch: "task/task-3",
    root: join(root, "_worktrees")
  });
  await writeFile(join(worktree.worktreePath, "shared.txt"), "subtask\n");
  await git(worktree.worktreePath, ["commit", "-am", "subtask shared change"]);

  await writeFile(join(fixture.repoPath, "shared.txt"), "parent\n");
  await git(fixture.repoPath, ["commit", "-am", "parent shared change"]);

  const result = await mergeSubtask({ parentPath: fixture.repoPath, subtaskBranch: "task/task-3" });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "conflict");
  assert.equal(result.conflict, true);
});
