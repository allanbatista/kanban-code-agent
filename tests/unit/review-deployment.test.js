import { execPath } from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeployment } from "../../packages/orchestrator/src/deployment-service.js";
import { parentMergeSemaphore, findParentMergeBusy } from "../../packages/orchestrator/src/merge-coordinator.js";
import { evaluateReview } from "../../packages/orchestrator/src/review-service.js";

test("merge coordinator exposes parent semaphore and busy task", () => {
  const tasks = [
    { id: "a", status: "merge_pending", worktree: { parentTaskId: "p" } },
    { id: "b", status: "running", worktree: { parentTaskId: "p" } }
  ];
  assert.equal(parentMergeSemaphore("p"), "parent:p:merge");
  assert.equal(findParentMergeBusy(tasks, tasks[1]).id, "a");
});

test("review service blocks critical findings and allows clean evidence", () => {
  assert.equal(evaluateReview({ findings: [{ severity: "critical", message: "regression" }] }).status, "blocked");
  assert.equal(evaluateReview({ findings: [], evidence: ["unit pass"] }).status, "merge_ready");
});

test("deployment service runs configured command and records rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-deploy-"));
  const release = await runDeployment({
    taskId: "KCA-DEPLOY",
    command: execPath,
    args: ["-e", "process.stdout.write('released')"],
    cwd: root,
    rollback: "redeploy previous artifact"
  });
  assert.equal(release.status, "released");
  assert.equal(release.stdout, "released");
  assert.match(release.rollback, /previous/);
});
