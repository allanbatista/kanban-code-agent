import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

// ---------------------------------------------------------------------------
// Kanban custom tools — registered in the assistant's Pi SDK session so the
// LLM can manage the board through typed, validated operations.
// ---------------------------------------------------------------------------

// Minimal JSON Schema builders — avoids dependency on @earendil-works/pi-ai/TypeBox
function TObject(properties, opts = {}) {
  const required = opts.required ?? Object.keys(properties);
  return { type: "object", properties, required, ...opts };
}
function TString(opts = {}) { return { type: "string", ...opts }; }
function TOptional(schema) { return { ...schema, optional: true }; }
function TArray(items, opts = {}) { return { type: "array", items, ...opts }; }

function buildKanbanTools(context) {
  // context = { root, createTask, moveTask, updateTask, getTask, listTasks, boardSnapshot,
  //             whyNotRunning, decomposeTask, readSettingsScope, updateSettings,
  //             runTask, interruptTask, orchestratorStatus, readAgent }
  const { defineTool } = context.sdkExports;

  const kcaListTasks = defineTool({
    name: "kca_list_tasks",
    label: "List tasks",
    description: "List all kanban tasks with their current column and status.",
    parameters: TObject({
      column: TOptional(TString({ description: "Filter by column id (inbox, definition, build, validate, blocked, done)" })),
      status: TOptional(TString({ description: "Filter by status (idle, queued, running, blocked, done, merge_pending)" }))
    }),
    async execute(_callId, params) {
      const tasks = await context.listTasks();
      let filtered = tasks;
      if (params.column) filtered = filtered.filter(t => t.column === params.column);
      if (params.status) filtered = filtered.filter(t => t.status === params.status);
      const lines = filtered.map(t => `${t.id} [${t.column}/${t.status}] ${t.title} (${t.priority})`);
      return { content: [{ type: "text", text: lines.length ? lines.join("\n") : "Nenhuma task encontrada." }], details: { count: lines.length, tasks: filtered.map(t => ({ id: t.id, title: t.title, column: t.column, status: t.status, priority: t.priority })) } };
    }
  });

  const kcaGetBoard = defineTool({
    name: "kca_get_board",
    label: "Get board",
    description: "Get the full board state including columns, tasks, and settings summary.",
    parameters: TObject({}),
    async execute() {
      const snapshot = await context.boardSnapshot();
      const tasks = (snapshot.tasks || []).map(t => `${t.id} [${t.column}] ${t.title}`);
      const columns = (snapshot.columns || []).map(c => `${c.id} (${c.label}) agent=${c.agent || "none"} wip=${c.wip ?? "∞"}`);
      const text = ["=== COLUNAS ===", ...columns, "", "=== TASKS ===", ...tasks].join("\n");
      return { content: [{ type: "text", text }], details: { columns: snapshot.columns, taskCount: tasks.length } };
    }
  });

  const kcaCreateTask = defineTool({
    name: "kca_create_task",
    label: "Create task",
    description: "Create a new kanban task. Returns the created task ID.",
    parameters: TObject({
      title: TString({ description: "Task title" }),
      description: TOptional(TString({ description: "Task description (markdown)" })),
      column: TOptional(TString({ description: "Initial column. Default: inbox", default: "inbox" })),
      priority: TOptional(TString({ description: "Priority: low, medium, high", default: "medium" })),
      kind: TOptional(TString({ description: "Task kind: task, master, subtask, spike, bug, chore", default: "task" })),
      projectTargets: TOptional(TArray(TString(), { description: "Project IDs this task targets" }))
    }),
    async execute(_callId, params) {
      const task = await context.createTask({
        title: params.title,
        description: params.description || "",
        column: params.column || "inbox",
        priority: params.priority || "medium",
        kind: params.kind || "task",
        projectTargets: params.projectTargets || []
      });
      return { content: [{ type: "text", text: `Task criada: ${task.id} - ${task.title}` }], details: { taskId: task.id, title: task.title } };
    }
  });

  const kcaMoveTask = defineTool({
    name: "kca_move_task",
    label: "Move task",
    description: "Move a task to a different column.",
    parameters: TObject({
      taskId: TString({ description: "Task ID to move (e.g. KCA-123456)" }),
      column: TString({ description: "Target column id: inbox, definition, build, validate, blocked, done" })
    }),
    async execute(_callId, params) {
      const task = await context.moveTask(params.taskId, params.column);
      return { content: [{ type: "text", text: `Task ${task.id} movida para ${params.column}.` }], details: { taskId: task.id, column: task.column } };
    }
  });

  const kcaGetTask = defineTool({
    name: "kca_get_task",
    label: "Get task details",
    description: "Get detailed information about a specific task.",
    parameters: TObject({
      taskId: TString({ description: "Task ID (e.g. KCA-123456)" })
    }),
    async execute(_callId, params) {
      const task = await context.getTask(params.taskId);
      if (!task) return { content: [{ type: "text", text: `Task ${params.taskId} não encontrada.` }], details: null };
      const deps = task.dependencies || {};
      const lines = [
        `ID: ${task.id}`, `Título: ${task.title}`, `Coluna: ${task.column}`, `Status: ${task.status}`,
        `Prioridade: ${task.priority}`, `Tipo: ${task.kind || "task"}`,
        `Projetos: ${(task.projectTargets || []).join(", ") || "nenhum"}`,
        `Agent: ${task.routing?.currentAgent || task.agent || "nenhum"}`,
        `Needs: ${(deps.needs || []).join(", ") || "nenhum"}`,
        `Provides: ${(deps.provides || []).join(", ") || "nenhum"}`,
        `File Locks: ${(deps.fileLocks || []).join(", ") || "nenhum"}`
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], details: task };
    }
  });

  const kcaWhyNotRunning = defineTool({
    name: "kca_why_not_running",
    label: "Why not running",
    description: "Explain why a task is not currently running.",
    parameters: TObject({
      taskId: TString({ description: "Task ID to diagnose" })
    }),
    async execute(_callId, params) {
      const why = await context.whyNotRunning(params.taskId);
      const text = why.runnable ? `Task ${params.taskId} está pronta para executar.` : `Task ${params.taskId}: ${why.reasons.join("; ") || "sem bloqueios observáveis."}`;
      return { content: [{ type: "text", text }], details: why };
    }
  });

  const kcaDecomposeTask = defineTool({
    name: "kca_decompose_task",
    label: "Decompose task",
    description: "Decompose a master task into parallel subtasks.",
    parameters: TObject({
      taskId: TString({ description: "Master task ID to decompose" }),
      subtasks: TOptional(TArray(TObject({
        title: TString({ description: "Subtask title" }),
        agent: TOptional(TString({ description: "Suggested agent: engineer, validator, architect", default: "engineer" })),
        needs: TOptional(TArray(TString(), { description: "Contracts this subtask needs" })),
        provides: TOptional(TArray(TString(), { description: "Contracts this subtask provides" }))
      }), { description: "Subtask definitions. If omitted, generates default implementation + validation subtasks." }))
    }),
    async execute(_callId, params) {
      const result = await context.decomposeTask(params.taskId, params.subtasks || []);
      const ids = result.taskIds || [];
      return { content: [{ type: "text", text: `Task ${params.taskId} decomposta em ${ids.length} subtasks: ${ids.join(", ")}.` }], details: result };
    }
  });

  const kcaReadSettings = defineTool({
    name: "kca_read_settings",
    label: "Read settings",
    description: "Read configuration for a given scope (app, agents, board, columns, projects, skills, hooks).",
    parameters: TObject({
      scope: TString({ description: "Settings scope: app, agents, board, columns, projects, skills, hooks" })
    }),
    async execute(_callId, params) {
      const settings = await context.readSettingsScope(params.scope);
      return { content: [{ type: "text", text: JSON.stringify(settings, null, 2).slice(0, 4000) }], details: settings };
    }
  });

  const kcaUpdateTask = defineTool({
    name: "kca_update_task",
    label: "Update task",
    description: "Update task fields (title, priority, kind, projectTargets).",
    parameters: TObject({
      taskId: TString({ description: "Task ID to update" }),
      title: TOptional(TString()),
      priority: TOptional(TString()),
      kind: TOptional(TString()),
      projectTargets: TOptional(TArray(TString()))
    }),
    async execute(_callId, params) {
      const { taskId, ...patch } = params;
      const task = await context.updateTask(taskId, patch);
      return { content: [{ type: "text", text: `Task ${task.id} atualizada.` }], details: task };
    }
  });

  const kcaRunTask = defineTool({
    name: "kca_run_task",
    label: "Run task",
    description: "Start execution of a task with its assigned agent.",
    parameters: TObject({
      taskId: TString({ description: "Task ID to run" }),
      agentId: TOptional(TString({ description: "Override agent (default: task's assigned agent)" }))
    }),
    async execute(_callId, params) {
      const result = await context.runTask(params.taskId, params.agentId);
      return { content: [{ type: "text", text: `Task ${params.taskId} iniciada com agent ${result.agentId}.` }], details: result };
    }
  });

  const kcaInterruptTask = defineTool({
    name: "kca_interrupt_task",
    label: "Interrupt task",
    description: "Interrupt a running task (soft or hard).",
    parameters: TObject({
      taskId: TString({ description: "Task ID to interrupt" }),
      mode: TOptional(TString({ description: "soft (checkpoint) or hard (abort)", default: "soft" }))
    }),
    async execute(_callId, params) {
      const result = await context.interruptTask(params.taskId, params.mode || "soft");
      return { content: [{ type: "text", text: `Task ${params.taskId} interrompida (${params.mode || "soft"}).` }], details: result };
    }
  });

  const kcaOrchestratorStatus = defineTool({
    name: "kca_orchestrator_status",
    label: "Orchestrator status",
    description: "Get orchestrator metrics: running tasks, queue, merges, worktrees, agent tokens.",
    parameters: TObject({}),
    async execute() {
      const status = await context.orchestratorStatus();
      const text = [
        `Tasks rodando: ${status.running}/${status.maxParallel || "∞"}`,
        `Fila: ${status.queued || 0}`,
        `Merges pendentes: ${status.mergePending || 0}`,
        `Worktrees ativos: ${status.activeWorktrees || 0}`,
        `Agents online: ${status.agentsOnline || 0}`,
        `Bloqueios: ${status.locks || 0}`
      ].join("\n");
      return { content: [{ type: "text", text }], details: status };
    }
  });

  return [
    kcaListTasks, kcaGetBoard, kcaCreateTask, kcaMoveTask, kcaGetTask,
    kcaWhyNotRunning, kcaDecomposeTask, kcaReadSettings, kcaUpdateTask,
    kcaRunTask, kcaInterruptTask, kcaOrchestratorStatus
  ];
}

// ---------------------------------------------------------------------------
// Board assistant agent — runs a real Pi SDK session with kanban tools.
// ---------------------------------------------------------------------------

export async function runBoardAssistant({ prompt, agentId = "assistant", instructions, root, context }) {
  const resolvedRoot = root || join(homedir(), ".kanban-code-agent");
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    return { ok: false, reply: `Pi SDK indisponível (${loaded.reason}). Usando fallback determinístico.` };
  }

  const sdk = loaded.sdk;
  if (!canUseSdk(sdk)) {
    return { ok: false, reply: "Pi SDK carregado mas sem API de sessão disponível." };
  }

  const agentDir = sdk.getAgentDir ? sdk.getAgentDir() : undefined;
  const sessionDir = join(resolvedRoot, "settings", "runtime", "sessions", "board-assistant", agentId);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(sessionDir, { recursive: true });

  const sessionManager = sdk.SessionManager.create(resolvedRoot, sessionDir);
  const tools = buildKanbanTools({ ...context, sdkExports: sdk });

  const { session, modelFallbackMessage } = await sdk.createAgentSession({
    cwd: resolvedRoot,
    agentDir,
    sessionManager,
    customTools: tools,
    thinkingLevel: "low",
    sessionStartEvent: { type: "session_start", reason: "new" }
  });

  session.setSessionName?.(`board-assistant:${agentId}`);

  let lastAssistantText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.message?.role === "assistant") {
      const text = Array.isArray(event.message.content)
        ? event.message.content.filter(c => c.type === "text").map(c => c.text).join("")
        : event.message.content || "";
      if (text) lastAssistantText = text; // keep only latest (streaming overwrites partials)
    }
  });

  try {
    const systemContext = instructions
      ? `${instructions}\n\nUse as ferramentas kca_* para gerenciar o board Kanban.`
      : "Você é o assistente do Kanban Code Agent. Use as ferramentas kca_* para gerenciar tasks, colunas e configurações. Responda em português brasileiro.";
    await session.prompt(`${systemContext}\n\n${prompt}`, { source: "sdk" });
    const reply = lastAssistantText || "Processado sem resposta textual.";
    return { ok: true, reply, modelFallbackMessage, agentId };
  } catch (error) {
    return { ok: false, reply: `Erro no agente: ${safeError(error)}` };
  } finally {
    unsubscribe?.();
    session.dispose?.();
  }
}

// ---------------------------------------------------------------------------
// Legacy — kept for task-session tests and orchestrator dry-runs.
// ---------------------------------------------------------------------------

export async function startPiSession({ task, agentId, runId, cwd, prompt, sessionDir, agentDir, previousSessionFile, tools = [], customTools = [], runPrompt = false }) {
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
