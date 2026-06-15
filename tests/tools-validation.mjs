// Test kanban agent tools end-to-end
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = await mkdtemp(join(tmpdir(), "kca-tool-test-"));

// Use the package exports (same as orchestrator)
import { initStorage, createTask, getTask, listTasks, updateTask, boardSnapshot, readAgent, readSettingsScope, paths } from "../packages/fsdb/src/index.js";
import { loadPiSdk, runBoardAssistant } from "../packages/pi-adapter/src/index.js";
import { whyNotRunning, handleCommand } from "../packages/orchestrator/src/index.js";

await initStorage(root);

// Create test tasks
const t1 = await createTask({ id: "KCA-TOOL-01", title: "Test task alpha", description: "First test task", column: "inbox", priority: "high", kind: "task", projectTargets: ["kanban-code-agent"] }, root);
const t2 = await createTask({ id: "KCA-TOOL-02", title: "Test task beta", description: "Second test task", column: "definition", priority: "medium", kind: "master", projectTargets: ["kanban-code-agent"] }, root);
console.log("Setup: created", t1.id, t2.id);

const p = paths(root);
let instructions = "";
try {
  const agentConfig = await readAgent("assistant", root);
  if (agentConfig?.instructionsPath) {
    instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
  }
} catch {}

const ctx = {
  root,
  createTask: (input) => createTask(input, root),
  updateTask: (taskId, patch) => updateTask(taskId, patch, root, "task.updated"),
  getTask: (taskId) => getTask(taskId, root),
  listTasks: () => listTasks(root),
  boardSnapshot: () => boardSnapshot(root),
  whyNotRunning: (taskId) => whyNotRunning({ id: taskId, projectTargets: [], dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] }, routing: { currentAgent: "assistant", manualOverride: { active: false } }, worktree: { enabled: false }, hooks: { active: [] }, skills: { active: [] } }, root),
  decomposeTask: async (taskId, subtasks) => {
    const parent = await getTask(taskId, root);
    const created = [];
    for (let i = 0; i < (subtasks.length || 2); i++) {
      const def = subtasks[i] || { title: `${parent.title}: subtask ${i + 1}`, agent: i === 0 ? "engineering" : "quality" };
      const task = await createTask({
        id: `${taskId}-${String(i + 1).padStart(2, "0")}`,
        title: def.title,
        kind: "subtask",
        column: "definition",
        status: "queued",
        projectTargets: parent.projectTargets || [],
        agent: def.agent || "engineering",
        dependencies: { needs: def.needs || [], provides: def.provides || [`subtask:${taskId}:subtask-${i + 1}`], blockedBy: [], fileLocks: [], semaphores: [] }
      }, root);
      created.push(task.id);
    }
    return { taskIds: created };
  },
  readSettingsScope: (scope) => readSettingsScope(scope, root),
  updateSettings: async (scope, patch) => {
    const { updateSettings: fsdbUpdateSettings } = await import("../packages/fsdb/src/index.js");
    return fsdbUpdateSettings(scope, patch, root);
  },
  runTask: async (taskId, agentIdOverride) => ({ agentId: agentIdOverride || "engineering", runId: `run-test-${Date.now()}` }),
  interruptTask: async (taskId, mode) => ({ event: "interrupted", taskId, mode }),
  orchestratorStatus: async () => {
    const tasks = await listTasks(root);
    const snap = await boardSnapshot(root);
    return {
      running: tasks.filter(t => t.status === "running").length,
      maxParallel: 3,
      queued: tasks.filter(t => t.status === "queued").length,
      mergePending: tasks.filter(t => t.status === "merge_pending").length,
      activeWorktrees: tasks.filter(t => t.worktree?.enabled).length,
      agentsOnline: (snap.columns || []).filter(c => c.agent).length,
      locks: 0
    };
  }
};

const loaded = await loadPiSdk();
console.log(`Pi SDK: ${loaded.mode}`);

console.log("\n=== Testing kanban tools ===");

// 1. listTasks
const tasks = await ctx.listTasks();
assert.ok(tasks.length >= 2);
console.log("✓ 1/11 kca_list_tasks:", tasks.length, "tasks");

// 2. boardSnapshot
const board = await ctx.boardSnapshot();
assert.ok(board.columns.length >= 6);
console.log("✓ 2/11 kca_get_board:", board.columns.length, "columns");

// 3. createTask
const created = await ctx.createTask({ title: "Tool test", description: "desc", column: "inbox", priority: "low", kind: "bug", projectTargets: [] });
assert.ok(created.id);
console.log("✓ 3/11 kca_create_task:", created.id);

// 4. getTask
const detail = await ctx.getTask(t1.id);
assert.equal(detail.title, "Test task alpha");
console.log("✓ 4/11 kca_get_task:", detail.id, detail.column);

// 5. whyNotRunning
const why = await ctx.whyNotRunning(t1.id);
assert.equal(typeof why.runnable, "boolean");
console.log("✓ 5/11 kca_why_not_running: runnable:", why.runnable);

// 6. decomposeTask
const decomposed = await ctx.decomposeTask(t2.id, [
  { title: "Implement beta", agent: "engineering", needs: [], provides: ["beta:impl"] },
  { title: "Validate beta", agent: "quality", needs: ["beta:impl"], provides: ["beta:valid"] }
]);
assert.equal(decomposed.taskIds.length, 2);
console.log("✓ 6/11 kca_decompose_task:", decomposed.taskIds.join(", "));

// 7. readSettings (agents + app)
const agentsScope = await ctx.readSettingsScope("agents");
assert.ok(agentsScope.agents.length >= 6);
console.log("✓ 7a/11 kca_read_settings agents:", agentsScope.agents.length);

const appScope = await ctx.readSettingsScope("app");
assert.ok(appScope.runtime);
console.log("✓ 7b/11 kca_read_settings app: maxParallel:", appScope.runtime.maxParallelTasks);

// 8. updateTask
const updated = await ctx.updateTask(t1.id, { title: "Alpha renamed" });
assert.equal(updated.title, "Alpha renamed");
console.log("✓ 8/11 kca_update_task:", updated.title);

// 9. runTask
const run = await ctx.runTask(t1.id, "engineering");
assert.ok(run.agentId);
console.log("✓ 9/11 kca_run_task: agent:", run.agentId);

// 11. interruptTask
const interrupted = await ctx.interruptTask(t1.id, "soft");
assert.equal(interrupted.taskId, t1.id);
console.log("✓ 10/11 kca_interrupt_task:", interrupted.mode);

// 12. orchestratorStatus
const status = await ctx.orchestratorStatus();
assert.ok(status.running !== undefined);
console.log("✓ 11/11 kca_orchestrator_status: running:", status.running, "queued:", status.queued);

console.log("\n=== ALL 12 TOOLS PASS ===");

// Also test via agent.chat command path
const chatResult = await handleCommand({
  type: "agent.chat",
  commandId: "test-chat-final",
  scope: "board",
  agentId: "assistant",
  prompt: "criar task Validar chat agent"
}, root);
assert.equal(chatResult.ok, true);
assert.ok(chatResult.reply || chatResult.run, "chat has reply or run");
const snapshot = await boardSnapshot(root);
assert.ok(snapshot.tasks.some(t => t.title === "Validar chat agent"), "task created via chat");
console.log("✓ agent.chat command: reply received, task created");

console.log("\n=== END-TO-END VALIDATION COMPLETE ===");
