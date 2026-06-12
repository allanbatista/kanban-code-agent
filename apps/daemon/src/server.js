import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createTask, initStorage, listTasks } from "@kca/fsdb";
import { handleCommand, handleQuery } from "@kca/orchestrator";
import { initialState } from "@kca/core";

const port = Number(process.env.KCA_DAEMON_PORT || 4174);
const root = process.env.KCA_STORAGE_ROOT;
const seedFixtures = process.env.KCA_SEED_FIXTURES === "1";
const fsdbPollMs = Number(process.env.KCA_FSDB_POLL_MS || 1000);
const schedulerPollMs = Number(process.env.KCA_SCHEDULER_POLL_MS ?? 1000);
const clients = new Set();
const sockets = new Set();
let schedulerTickRunning = false;
let readyPromise;

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
  const message = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === 1) socket.send(message);
  }
}

async function executeRpcMessage(message) {
  if (message.type === "query") {
    return { id: message.id, type: "query.result", ok: true, data: await handleQuery(message.query, root) };
  }
  if (message.type === "command") {
    const result = await handleCommand(message.command, root);
    broadcast({ type: "command.result", result });
    return { id: message.id, type: "command.result", ok: true, result };
  }
  if (message.type === "subscribe") {
    return { id: message.id, type: "subscribed", ok: true, topics: message.topics || ["commands"] };
  }
  return { id: message.id, type: "error", ok: false, error: "unsupported_message" };
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function seedIfEmpty() {
  if (!seedFixtures) return;
  if ((await listTasks(root)).length) return;
  for (const task of initialState().tasks) {
    await createTask({
      id: task.id,
      title: task.title,
      description: task.description || "",
      kind: task.kind,
      column: task.column,
      status: task.status,
      priority: task.priority,
      projectTargets: task.projectTargets || [],
      agent: task.agent,
      branch: task.branch,
      dependencies: {
        needs: task.needs || [],
        provides: task.provides || [],
        blockedBy: [],
        fileLocks: task.locks || [],
        semaphores: []
      },
      hooks: { active: task.hooks || [] },
      skills: { active: task.skills || [] }
    }, root);
  }
}

async function ensureReady() {
  readyPromise ??= (async () => {
    const storage = await initStorage(root);
    await seedIfEmpty();
    return storage;
  })();
  return readyPromise;
}

function stateFingerprint(state) {
  return JSON.stringify({
    columns: state.columns?.map((column) => ({ id: column.id, label: column.label, agent: column.agent, autoStart: column.autoStart, wip: column.wip, wipLimit: column.wipLimit, hooks: column.hooks })),
    tasks: state.tasks?.map((task) => ({ id: task.id, title: task.title, column: task.column, status: task.status, updatedAt: task.updatedAt, projectTargets: task.projectTargets, routing: task.routing, dependencies: task.dependencies, worktree: task.worktree })),
    settings: { ui: state.settings?.ui, runtime: state.settings?.runtime, safety: state.settings?.safety }
  });
}

async function startFsdbPoller() {
  if (fsdbPollMs <= 0) return;
  await ensureReady();
  let last = stateFingerprint(await handleQuery({ type: "board.snapshot" }, root));
  const timer = setInterval(async () => {
    try {
      const state = await handleQuery({ type: "board.snapshot" }, root);
      const next = stateFingerprint(state);
      if (next === last) return;
      last = next;
      broadcast({ type: "fsdb.changed", ts: new Date().toISOString() });
    } catch (error) {
      broadcast({ type: "fsdb.watch_error", ts: new Date().toISOString(), message: error.message });
    }
  }, fsdbPollMs);
  timer.unref?.();
}

async function runSchedulerTick(source = "loop") {
  if (schedulerTickRunning) return null;
  schedulerTickRunning = true;
  try {
    await ensureReady();
    const state = await handleQuery({ type: "board.snapshot" }, root);
    if (!state.tasks?.some((task) => task.status === "queued")) return null;
    const result = await handleCommand({ type: "scheduler.tick", commandId: `scheduler-${source}-${Date.now()}` }, root);
    broadcast({ type: "scheduler.tick", result });
    return result;
  } catch (error) {
    broadcast({ type: "scheduler.error", ts: new Date().toISOString(), message: error.message });
    return { ok: false, error: error.message };
  } finally {
    schedulerTickRunning = false;
  }
}

async function startSchedulerLoop() {
  if (schedulerPollMs <= 0) return;
  await runSchedulerTick("startup");
  const timer = setInterval(() => {
    void runSchedulerTick("loop");
  }, schedulerPollMs);
  timer.unref?.();
}

const server = createServer(async (req, res) => {
  try {
    const storage = await ensureReady();
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.url === "/health") return json(res, 200, { ok: true, storageRoot: storage.root, seededFixtures: seedFixtures, schedulerPollMs });
    if (req.url === "/api/state" && req.method === "GET") return json(res, 200, await handleQuery({ type: "board.snapshot" }, root));
    if (req.url === "/api/query" && req.method === "POST") return json(res, 200, await handleQuery(await body(req), root));
    if (req.url === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
        "access-control-allow-origin": "*"
      });
      res.write(`data: ${JSON.stringify({ type: "connected", ts: new Date().toISOString() })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.url === "/api/command" && req.method === "POST") {
      const result = await handleCommand(await body(req), root);
      broadcast({ type: "command.result", result });
      return json(res, 200, result);
    }

    if (req.url === "/api/task.move" && req.method === "POST") {
      const input = await body(req);
      const result = await handleCommand({ type: "task.move", taskId: input.taskId, toColumn: input.toColumn, mode: input.mode, commandId: input.commandId || `cmd-${Date.now()}` }, root);
      broadcast({ type: "command.result", result });
      return json(res, 200, result);
    }

    if (req.url === "/api/settings.update" && req.method === "POST") {
      const input = await body(req);
      const result = await handleCommand({ type: "settings.update", scope: input.scope || "app", patch: input.patch || {}, commandId: input.commandId || `cmd-${Date.now()}` }, root);
      broadcast({ type: "command.result", result });
      return json(res, 200, result);
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`kanban-code-agent daemon listening on http://127.0.0.1:${port}`);
});

void startFsdbPoller();
void startSchedulerLoop();

const wss = new WebSocketServer({ server, path: "/api/rpc" });

wss.on("connection", async (socket) => {
  sockets.add(socket);
  socket.send(JSON.stringify({ type: "connected", transport: "websocket", ts: new Date().toISOString() }));
  socket.on("close", () => sockets.delete(socket));
  socket.on("message", async (raw) => {
    try {
      await ensureReady();
      const response = await executeRpcMessage(JSON.parse(raw.toString("utf8")));
      socket.send(JSON.stringify(response));
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", ok: false, error: "internal_error", message: error.message }));
    }
  });
});
