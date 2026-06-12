import { spawn } from "node:child_process";

// Suppress EPIPE/EIO errors when stdin is closed or disconnected (common in some terminals)
process.stdin.on("error", (err) => {
  if (err.code === "EIO" || err.code === "EPIPE") return;
  throw err;
});
process.stdin.resume();

const daemonPort = process.env.KCA_DAEMON_PORT || "15000";
const daemonUrl = `http://127.0.0.1:${daemonPort}`;
const webArgs = process.argv.slice(2);
if (webArgs[0] === "--") webArgs.shift();
if (!webArgs.includes("--port")) webArgs.push("--port", process.env.KCA_WEB_PORT || "15001");
const children = new Set();

function spawnCommand(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"]
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function stopAll(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

async function runInit() {
  await new Promise((resolve, reject) => {
    const child = spawnCommand("node", ["apps/cli/src/kca.js", "init"]);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`kca init failed with code ${code}`));
    });
  });
}

async function waitForDaemon(child) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) throw new Error(`daemon exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${daemonUrl}/health`);
      if (response.ok) return;
    } catch {
      // daemon still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`daemon did not become healthy at ${daemonUrl}/health`);
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  process.exit(143);
});

await runInit();
const daemon = spawnCommand("pnpm", ["--filter", "@kca/daemon", "dev"], { KCA_DAEMON_PORT: daemonPort });
await waitForDaemon(daemon);
const web = spawnCommand("pnpm", ["--filter", "@kca/web", "dev", ...webArgs], { VITE_KCA_DAEMON_URL: daemonUrl });

web.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});
daemon.on("exit", (code) => {
  stopAll();
  process.exit(code ?? 0);
});
