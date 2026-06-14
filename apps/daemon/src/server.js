import { createServer } from "node:http";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { createEventBus } from "@kca/application/event-bus";
import { createBoardService } from "@kca/board-service";
import { createTask, initStorage, listTasks } from "@kca/fsdb";
import { handleCommand, handleQuery } from "@kca/orchestrator";
import { recoverStaleRuns } from "@kca/orchestrator/scheduler";
import { initialState } from "@kca/core";
import { logStep } from "@kca/core/log";

process.env.KCA_STDOUT_LOGS ??= "1";

const port = Number(process.env.KCA_DAEMON_PORT || 15000);
const root = process.env.KCA_STORAGE_ROOT;
const seedFixtures = process.env.KCA_SEED_FIXTURES === "1";
const fsdbPollMs = Number(process.env.KCA_FSDB_POLL_MS || 1000);
const clients = new Set();
const sockets = new Set();
const eventBus = createEventBus();
let schedulerTickRunning = false;
let readyPromise;
let boardService;
let eventBusConfigured = false;

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

function configureEventBus() {
  if (eventBusConfigured) return;
  eventBusConfigured = true;
  eventBus.subscribe("command.result", (event) => {
    boardService?.invalidate?.("command.result");
    broadcast({ type: "command.result", result: event.result });
    if (event.result?.scheduler) broadcast({ type: "scheduler.tick", result: event.result.scheduler });
  });
  eventBus.subscribe("scheduler.tick", (event) => broadcast({ type: "scheduler.tick", result: event.result }));
  eventBus.subscribe("scheduler.error", (event) => broadcast({ type: "scheduler.error", ts: event.ts, message: event.message }));
  eventBus.subscribe("fsdb.changed", (event) => {
    boardService?.invalidate?.("external-fsdb-change");
    broadcast({ type: "fsdb.changed", ts: event.ts });
  });
  eventBus.subscribe("fsdb.watch_error", (event) => broadcast({ type: "fsdb.watch_error", ts: event.ts, message: event.message }));
}

async function broadcastCommandResult(result) {
  await eventBus.publish({ type: "command.result", result });
}

async function executeRpcMessage(message) {
  logStep("daemon", "rpc.message", { type: message.type, id: message.id });
  if (message.type === "query") {
    return { id: message.id, type: "query.result", ok: true, data: await handleQuery(message.query, root) };
  }
  if (message.type === "command") {
    const result = await handleCommand(message.command, root);
    await broadcastCommandResult(result);
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
  logStep("daemon", "seedIfEmpty.start");
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
  logStep("daemon", "seedIfEmpty.done");
}

async function ensureReady() {
  readyPromise ??= (async () => {
    logStep("daemon", "ensureReady.start");
    const storage = await initStorage(root);
    boardService = createBoardService(root);
    configureEventBus();
    await seedIfEmpty();
    logStep("daemon", "ensureReady.done", { root: storage.root });
    return storage;
  })();
  return readyPromise;
}

function stateFingerprint(state) {
  return JSON.stringify({
    columns: state.columns?.map((column) => ({ id: column.id, label: column.label, agent: column.agent, role: column.role, autoStart: column.autoStart, wip: column.wip, wipLimit: column.wipLimit, hooks: column.hooks })),
    tasks: state.tasks?.map((task) => ({ id: task.id, title: task.title, column: task.column, status: task.status, updatedAt: task.updatedAt, projectTargets: task.projectTargets, routing: task.routing, dependencies: task.dependencies, worktree: task.worktree })),
    settings: { ui: state.settings?.ui, runtime: state.settings?.runtime, safety: state.settings?.safety, ai: state.settings?.ai }
  });
}

async function fileFingerprint(rootPath) {
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const rows = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (path.includes(`${join("settings", "runtime")}${"/"}`) || path.endsWith(join("settings", "runtime"))) continue;
      if (entry.isDirectory()) rows.push(...await walk(path));
      else {
        const info = await stat(path).catch(() => null);
        if (info) rows.push(`${path}:${info.mtimeMs}:${info.size}`);
      }
    }
    return rows;
  }
  return (await walk(rootPath)).sort().join("|");
}

async function startFsdbPoller() {
  if (fsdbPollMs <= 0) return;
  logStep("daemon", "fsdbPoller.start", { fsdbPollMs });
  const storage = await ensureReady();
  let last = await fileFingerprint(storage.root);
  const timer = setInterval(async () => {
    try {
      const next = await fileFingerprint(storage.root);
      if (next === last) return;
      last = next;
      logStep("daemon", "fsdbPoller.changed");
      await eventBus.publish({ type: "fsdb.changed", ts: new Date().toISOString() });
    } catch (error) {
      logStep("daemon", "fsdbPoller.error", { message: error.message });
      await eventBus.publish({ type: "fsdb.watch_error", ts: new Date().toISOString(), message: error.message });
    }
  }, fsdbPollMs);
  timer.unref?.();
}

async function runSchedulerTick(source = "startup") {
  if (schedulerTickRunning) return null;
  schedulerTickRunning = true;
  try {
    logStep("daemon", "schedulerTick.start", { source });
    await ensureReady();
    const state = await boardService.snapshot();
    if (!state.tasks?.some((task) => task.status === "queued")) return null;
    const result = await handleCommand({ type: "scheduler.tick", commandId: `scheduler-${source}-${Date.now()}` }, root);
    if (result.started?.length || result.blocked?.length || result.skipped?.length) {
      logStep("daemon", "schedulerTick.result", { source, started: result.started?.map((item) => item.taskId) || [], blocked: result.blocked?.length || 0, skipped: result.skipped?.length || 0 });
    }
    await eventBus.publish({ type: "scheduler.tick", result });
    return result;
  } catch (error) {
    await eventBus.publish({ type: "scheduler.error", ts: new Date().toISOString(), message: error.message });
    logStep("daemon", "schedulerTick.error", { source, message: error.message });
    return { ok: false, error: error.message };
  } finally {
    schedulerTickRunning = false;
  }
}

async function startSchedulerRecovery() {
  logStep("daemon", "schedulerRecovery.start");
  await recoverStaleRuns(root);
  await runSchedulerTick("startup");
}

const server = createServer(async (req, res) => {
  try {
    const storage = await ensureReady();
    logStep("daemon", "http.request", { method: req.method, url: req.url });
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.url === "/health") return json(res, 200, { ok: true, storageRoot: storage.root, seededFixtures: seedFixtures, schedulerMode: "event-driven", schedulerPollMs: 0 });
    if (req.url === "/api/state" && req.method === "GET") return json(res, 200, await boardService.snapshot());
    if (req.url === "/api/query" && req.method === "POST") return json(res, 200, await handleQuery(await body(req), root));
    if (req.url === "/api/events" && req.method === "GET") {
      logStep("daemon", "sse.connect");
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
      await broadcastCommandResult(result);
      return json(res, 200, result);
    }

    if (req.url === "/api/task.move" && req.method === "POST") {
      const input = await body(req);
      const result = await handleCommand({ type: "task.move", taskId: input.taskId, toColumn: input.toColumn, mode: input.mode, commandId: input.commandId || `cmd-${Date.now()}` }, root);
      await broadcastCommandResult(result);
      return json(res, 200, result);
    }

    if (req.url === "/api/settings.update" && req.method === "POST") {
      const input = await body(req);
      const result = await handleCommand({ type: "settings.update", scope: input.scope || "app", patch: input.patch || {}, commandId: input.commandId || `cmd-${Date.now()}` }, root);
      await broadcastCommandResult(result);
      return json(res, 200, result);
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    logStep("daemon", "http.error", { message: error.message });
    return json(res, 500, { error: "internal_error", message: error.message });
  }
});

function startWebSocketServer() {
  const wss = new WebSocketServer({ server, path: "/api/rpc" });
  wss.on("connection", async (socket) => {
    logStep("daemon", "ws.connect");
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "connected", transport: "websocket", ts: new Date().toISOString() }));
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", async (raw) => {
      try {
        logStep("daemon", "ws.message");
        await ensureReady();
        const response = await executeRpcMessage(JSON.parse(raw.toString("utf8")));
        socket.send(JSON.stringify(response));
      } catch (error) {
        logStep("daemon", "ws.error", { message: error.message });
        socket.send(JSON.stringify({ type: "error", ok: false, error: "internal_error", message: error.message }));
      }
    });
  });
}

server.on("error", (error) => {
  logStep("daemon", "listen.error", { code: error.code, message: error.message, port });
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  logStep("daemon", "listen", { url: `http://127.0.0.1:${port}` });
  startWebSocketServer();
  void startFsdbPoller();
  void startSchedulerRecovery();
});
