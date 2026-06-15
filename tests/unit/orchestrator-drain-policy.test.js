import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../../packages/application/src/event-bus.js";
import { initStorage } from "../../packages/fsdb/src/index.js";
import { createReconcilerQueue } from "../../packages/orchestrator/src/reconciler.js";

test("command.executed events enqueue orchestrator reconciliation", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-reconcile-event-"));
  await initStorage(root);
  const eventBus = createEventBus();
  const seen = [];
  const errors = [];
  const queue = createReconcilerQueue({
    root,
    eventBus,
    whyNotRunning: () => ({ runnable: true, reasons: [] }),
    runTask: () => ({ ok: true }),
    onResult: (result) => seen.push(result.source),
    onError: (error) => errors.push(error)
  });

  await eventBus.publish({ type: "command.executed", commandType: "task.decompose", commandId: "cmd-decompose", result: { ok: true } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  queue.stop();

  assert.deepEqual(errors, []);
  assert.deepEqual(seen, ["task.decompose"]);
});
