import { access } from "node:fs/promises";

const defaultPackage = "@earendil-works/pi-coding-agent";
const verifiedVersion = "0.79.1";

function safeError(error) {
  return error?.code || error?.message || String(error);
}

function canUseSdk(sdk) {
  return typeof sdk?.createAgentSession === "function" && typeof sdk?.SessionManager?.create === "function";
}

async function fileExists(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function loadPiSdk(packageName = process.env.KCA_PI_SDK_PACKAGE || defaultPackage) {
  if (process.env.KCA_PI_ADAPTER === "fake") {
    return { ok: false, mode: "fake", sdk: null, packageName, version: "forced-fake", reason: "forced_by_env" };
  }
  try {
    const sdk = await import(packageName);
    return {
      ok: true,
      mode: "real",
      sdk,
      packageName,
      version: sdk.VERSION || (packageName === defaultPackage ? verifiedVersion : "unknown"),
      api: {
        createAgentSession: typeof sdk.createAgentSession === "function",
        SessionManager: typeof sdk.SessionManager?.create === "function",
        defineTool: typeof sdk.defineTool === "function"
      }
    };
  } catch (error) {
    return { ok: false, mode: "fake", sdk: null, packageName, version: "unavailable", reason: safeError(error) };
  }
}

export async function startPiSession({ task, agentId, runId, cwd, prompt, sessionDir, agentDir, previousSessionFile, tools = [], customTools = [], runPrompt = process.env.KCA_PI_RUN_PROMPT === "1" }) {
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    return {
      mode: "fake",
      provider: loaded.packageName,
      reason: loaded.reason,
      sessionId: runId,
      cwd,
      promptPreview: String(prompt || task.title || "").slice(0, 160)
    };
  }

  const sdk = loaded.sdk;
  if (!canUseSdk(sdk)) {
    return { mode: "real", provider: loaded.packageName, version: loaded.version, sessionId: runId, warning: "Pi SDK loaded without createAgentSession/SessionManager" };
  }

  const timeoutMs = Number(process.env.KCA_PI_SESSION_TIMEOUT_MS || 2500);
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({
      mode: "fake",
      provider: loaded.packageName,
      version: loaded.version,
      reason: "session_timeout",
      sessionId: runId,
      previousSessionFile,
      cwd,
      promptPreview: String(prompt || task.title || "").slice(0, 160)
    }), timeoutMs);
  });
  const real = (async () => {
    const sessionManager = sdk.SessionManager.create(cwd || process.cwd(), sessionDir);
    const { session, modelFallbackMessage } = await sdk.createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      customTools,
      tools: tools.length ? tools : undefined,
      noTools: tools.length ? undefined : "builtin",
      sessionStartEvent: {
        type: "session_start",
        reason: previousSessionFile ? "resume" : "new",
        previousSessionFile
      }
    });
    session.setSessionName?.(`${task.id}:${agentId}`);
    const events = [];
    const unsubscribe = session.subscribe((event) => {
      events.push({ type: event.type, ts: new Date().toISOString() });
    });
    try {
      if (runPrompt) {
        await session.prompt(String(prompt || task.title || ""), { source: "sdk" });
      }
      return {
        mode: "real",
        provider: loaded.packageName,
        version: loaded.version,
        sessionId: session.sessionId || sessionManager.getSessionId?.() || runId,
        sessionFile: session.sessionFile || sessionManager.getSessionFile?.(),
        previousSessionFile,
        cwd,
        promptPreview: String(prompt || task.title || "").slice(0, 160),
        promptSent: Boolean(runPrompt),
        activeTools: session.getActiveToolNames?.() || [],
        modelFallbackMessage,
        events
      };
    } finally {
      unsubscribe?.();
      session.dispose?.();
    }
  })();
  return Promise.race([real, timeout]);
}

export async function doctorPi({ cwd = process.cwd(), sessionDir, runPrompt = false } = {}) {
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    return {
      ok: false,
      sdk: { packageName: loaded.packageName, mode: loaded.mode, version: loaded.version, reason: loaded.reason },
      auth: { filePresent: false },
      dryRun: null
    };
  }

  const authPath = typeof loaded.sdk.getAuthPath === "function" ? loaded.sdk.getAuthPath() : undefined;
  const agentDir = typeof loaded.sdk.getAgentDir === "function" ? loaded.sdk.getAgentDir() : undefined;
  let dryRun = null;
  try {
    dryRun = await startPiSession({
      task: { id: "KCA-DOCTOR", title: "Kanban Code Agent Pi doctor" },
      agentId: "doctor",
      runId: `run_doctor_${Date.now()}`,
      cwd,
      sessionDir,
      prompt: "Pi doctor dry-run.",
      runPrompt
    });
  } catch (error) {
    dryRun = { mode: "error", reason: safeError(error) };
  }

  return {
    ok: loaded.ok && loaded.api.createAgentSession && loaded.api.SessionManager && dryRun?.mode === "real",
    sdk: {
      packageName: loaded.packageName,
      version: loaded.version,
      api: loaded.api
    },
    auth: {
      agentDir,
      authPath,
      filePresent: await fileExists(authPath)
    },
    dryRun
  };
}
