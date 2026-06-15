import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_RESPONSE_POLICY } from "@kca/core/agent-response-policy";
import { logStep } from "@kca/core/log";

const defaultPackage = "@earendil-works/pi-coding-agent";
const verifiedVersion = "0.79.1";

function safeError(error) {
  return error?.code || error?.message || String(error);
}

function truncate(value, max = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    if (typeof part.input === "string") return part.input;
    if (typeof part.reasoning === "string") return part.reasoning;
    if (typeof part.summary === "string") return part.summary;
    if (typeof part.output === "string") return part.output;
    if (typeof part.result === "string") return part.result;
    if (part.arguments || part.input || part.params) return truncate(part.arguments || part.input || part.params, 1200);
    return "";
  }).filter(Boolean).join("");
}

function numericToken(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function numericPositive(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function providerRequestTimeoutMs(providerConfig = {}) {
  return numericPositive(
    providerConfig.requestTimeoutMs,
    providerConfig.timeoutMs,
    process.env.KCA_OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS,
    process.env.KCA_PROVIDER_REQUEST_TIMEOUT_MS,
    60000
  );
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fetchImpl(url, init);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      const error = new Error(`request_timeout:${timeoutMs}`);
      error.code = "request_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, ...(controller ? { signal: controller.signal } : {}) }),
      timeout
    ]);
  } catch (error) {
    if (error?.code === "request_timeout" || error?.name === "AbortError" || controller?.signal?.aborted) {
      const timeoutError = new Error(`request_timeout:${timeoutMs}`);
      timeoutError.code = "request_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function modelContextWindow(providerConfig = {}, model) {
  const direct = numericPositive(
    providerConfig.contextWindow,
    providerConfig.context_window,
    providerConfig.contextLength,
    providerConfig.context_length
  );
  if (direct) return direct;
  const models = providerConfig.models;
  const modelId = String(model || "");
  const found = Array.isArray(models)
    ? models.find((item) => [item?.id, item?.name, item?.model].map(String).includes(modelId))
    : models && typeof models === "object"
      ? models[modelId]
      : null;
  return numericPositive(
    found?.contextWindow,
    found?.context_window,
    found?.contextLength,
    found?.context_length,
    found?.top_provider?.context_length,
    found?.limits?.context_window,
    found?.limits?.max_context_length
  );
}

export function normalizeProviderUsage(rawUsage, { contextWindow } = {}) {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const inputTokens = numericToken(rawUsage.prompt_tokens, rawUsage.input_tokens, rawUsage.inputTokens, rawUsage.input);
  const outputTokens = numericToken(rawUsage.completion_tokens, rawUsage.output_tokens, rawUsage.outputTokens, rawUsage.output);
  const totalTokens = numericToken(rawUsage.total_tokens, rawUsage.totalTokens) ?? (
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined
  );
  const cacheReadTokens = numericToken(
    rawUsage.cacheRead,
    rawUsage.cache_read,
    rawUsage.cache_read_input_tokens,
    rawUsage.prompt_cache_hit_tokens,
    rawUsage.prompt_tokens_details?.cached_tokens,
    rawUsage.input_tokens_details?.cached_tokens
  );
  const cacheWriteTokens = numericToken(rawUsage.cacheWrite, rawUsage.cache_write, rawUsage.cache_creation_input_tokens);
  const cacheTokens = numericToken(
    rawUsage.cached_tokens,
    rawUsage.cache_tokens,
    rawUsage.cachedTokens
  ) ?? (
    cacheReadTokens !== undefined || cacheWriteTokens !== undefined ? (cacheReadTokens || 0) + (cacheWriteTokens || 0) : undefined
  );
  const resolvedContextWindow = numericPositive(contextWindow, rawUsage.contextWindow, rawUsage.context_window);
  const contextTokens = inputTokens !== undefined || outputTokens !== undefined ? (inputTokens || 0) + (outputTokens || 0) : undefined;
  const contextPercent = contextTokens !== undefined && resolvedContextWindow
    ? Math.round((contextTokens / resolvedContextWindow) * 1000) / 10
    : undefined;
  const usage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheTokens !== undefined ? { cacheTokens } : {}),
    ...(resolvedContextWindow ? { contextWindow: resolvedContextWindow } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {})
  };
  return Object.keys(usage).length ? usage : null;
}

function contentKinds(content) {
  if (!Array.isArray(content)) return [];
  return [...new Set(content.map((part) => part?.type).filter(Boolean))];
}

function firstContentPart(content, pattern) {
  if (!Array.isArray(content)) return null;
  return content.find((part) => part?.type && pattern.test(part.type)) || null;
}

function toolPartText(part) {
  if (!part) return "";
  const name = part.name || part.tool || part.toolName || part.id || "tool";
  const args = part.arguments || part.args || part.input || part.params;
  return `${name}${args ? ` ${truncate(args, 500)}` : ""}`;
}

function plainEvent(event) {
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    return { type: event?.type || "event", unserializable: true };
  }
}

function normalizeSessionEvent(event) {
  const base = { providerEventType: event?.type || "event" };
  const providerEvent = plainEvent(event);
  const message = event?.message;
  if (message) {
    const kinds = contentKinds(message.content);
    const toolCallPart = firstContentPart(message.content, /tool.?call/i);
    const toolResultPart = firstContentPart(message.content, /tool.?result|tool.?output/i);
    const reasoningPart = firstContentPart(message.content, /reason|think/i);
    if (toolCallPart) {
      return {
        ...base,
        type: "agent.transcript",
        category: "tool_call",
        role: message.role || event.role || "assistant",
        text: toolPartText(toolCallPart),
        contentKinds: kinds,
        toolCall: plainEvent(toolCallPart),
        providerEvent
      };
    }
    if (toolResultPart) {
      return {
        ...base,
        type: "agent.transcript",
        category: "tool_result",
        role: message.role || event.role || "assistant",
        text: truncate(contentText([toolResultPart]) || toolResultPart.output || toolResultPart.result || toolResultPart.content || toolResultPart.text || "tool_result"),
        contentKinds: kinds,
        toolResult: plainEvent(toolResultPart),
        providerEvent
      };
    }
    const category = reasoningPart ? "reasoning" : "message";
    return {
      ...base,
      type: "agent.transcript",
      category,
      role: message.role || event.role || "assistant",
      text: truncate(contentText(message.content) || message.text || message.content || ""),
      contentKinds: kinds,
      providerEvent
    };
  }
  const toolCall = event?.toolCall || event?.tool_call || event?.tool || event?.call;
  if (toolCall) {
    return { ...base, type: "agent.transcript", category: "tool_call", text: truncate(toolCall.name || toolCall.tool || event.name || event.type), toolCall: plainEvent(toolCall), providerEvent };
  }
  const toolResult = event?.toolResult || event?.tool_result || event?.result;
  if (toolResult) {
    return { ...base, type: "agent.transcript", category: "tool_result", text: truncate(toolResult.text || toolResult.output || toolResult.content || event.type), toolResult: plainEvent(toolResult), providerEvent };
  }
  const text = event?.text || event?.content || event?.delta || "";
  if (text) return { ...base, type: "agent.transcript", category: "event", text: truncate(text), providerEvent };
  return { ...base, type: "agent.transcript", category: "event", text: truncate(event?.type || "event"), providerEvent };
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
  logStep("pi-adapter", "loadPiSdk.start", { packageName });
  if (process.env.KCA_PI_ADAPTER === "fake") {
    logStep("pi-adapter", "loadPiSdk.fake", { packageName });
    return { ok: false, mode: "fake", sdk: null, packageName, version: "forced-fake", reason: "forced_by_env" };
  }
  try {
    const sdk = await import(packageName);
    const result = {
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
    logStep("pi-adapter", "loadPiSdk.done", { packageName, mode: result.mode, version: result.version });
    return result;
  } catch (error) {
    logStep("pi-adapter", "loadPiSdk.error", { packageName, reason: safeError(error) });
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
function TNumber(opts = {}) { return { type: "number", ...opts }; }

function cleanJsonSchema(schema = {}) {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.type === "object") {
    const properties = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [key, cleanJsonSchema(value)]));
    const required = Object.entries(schema.properties || {}).filter(([, value]) => !value?.optional).map(([key]) => key);
    const { optional, ...rest } = schema;
    return { ...rest, properties, required, additionalProperties: false };
  }
  if (schema.type === "array") {
    const { optional, ...rest } = schema;
    return { ...rest, items: cleanJsonSchema(schema.items) };
  }
  const { optional, ...rest } = schema;
  return rest;
}

function toolsToOpenAI(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description || tool.label || tool.name,
      parameters: cleanJsonSchema(tool.parameters || TObject({}))
    }
  }));
}

export function buildKanbanTools(context) {
  // context = { root, createTask, moveTask, updateTask, getTask, listTasks, boardSnapshot,
  //             whyNotRunning, decomposeTask, readSettingsScope, updateSettings,
  //             runTask, interruptTask, orchestratorStatus, readAgent }
  const { defineTool } = context.sdkExports;

  const kcaListTasks = defineTool({
    name: "kca_list_tasks",
    label: "List tasks",
    description: "List all kanban tasks with their current column and status.",
    parameters: TObject({
      column: TOptional(TString({ description: "Filter by column id (inbox, manager, product, design, architecture, generalist, engineering, quality, review, deployment, human_wait, done)" })),
      status: TOptional(TString({ description: "Filter by status (idle, queued, running, failed, done, merge_pending)" }))
    }),
    async execute(_callId, params) {
      const tasks = await context.listTasks();
      let filtered = tasks;
      if (params.column) filtered = filtered.filter(t => t.column === params.column);
      if (params.status) filtered = filtered.filter(t => t.status === params.status);
      const lines = filtered.map(t => `${t.id} [${t.column}/${t.status}] ${t.title}`);
      return { content: [{ type: "text", text: lines.length ? lines.join("\n") : "Nenhuma task encontrada." }], details: { count: lines.length, tasks: filtered.map(t => ({ id: t.id, title: t.title, column: t.column, status: t.status })) } };
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
      column: TOptional(TString({ description: "Initial column. Default: manager", default: "manager" })),
      projectTargets: TOptional(TArray(TString(), { description: "Project IDs this task targets" }))
    }),
    async execute(_callId, params) {
      const task = await context.createTask({
        title: params.title,
        description: params.description || "",
        column: params.column || "manager",
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
      column: TString({ description: "Target column id: inbox, manager, product, design, architecture, generalist, engineering, quality, review, deployment, human_wait, done" })
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
      const text = why.runnable ? `Task ${params.taskId} está pronta para executar.` : `Task ${params.taskId}: ${why.reasons.join("; ") || "sem impedimentos observáveis."}`;
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
        role: TOptional(TString({ description: "Canonical role: architecture, engineering, quality, review, etc.", default: "engineering" })),
        agent: TOptional(TString({ description: "Legacy alias; use role for new subtasks." })),
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
    description: "Update task fields (title, projectTargets).",
    parameters: TObject({
      taskId: TString({ description: "Task ID to update" }),
      title: TOptional(TString()),
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

function commandIdFor(toolName, taskId) {
  return `pi-tool-${toolName}-${taskId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function compactWorkflowResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ok: result.ok ?? true,
    commandId: result.commandId,
    task: result.task ? {
      id: result.task.id,
      column: result.task.column,
      status: result.task.status,
      currentRole: result.task.routing?.currentRole,
      currentAgent: result.task.routing?.currentAgent
    } : undefined,
    parentTask: result.parentTask ? {
      id: result.parentTask.id,
      column: result.parentTask.column,
      status: result.parentTask.status,
      currentRole: result.parentTask.routing?.currentRole,
      currentAgent: result.parentTask.routing?.currentAgent
    } : undefined,
    message: result.message ? {
      persona: result.message.persona,
      disposition: result.message.disposition,
      text: truncate(result.message.text || "", 500)
    } : undefined,
    inputPath: result.inputPath,
    artifactPath: result.path || result.artifactPath,
    summaryRef: result.summaryRef,
    delegation: result.delegation
  };
}

function formatToolResultContent(name, command, result) {
  if (name !== "run_command") return `${name} executed: ${command.commandId}`;
  const stdout = truncate(result?.stdout || "", 12000);
  const stderr = truncate(result?.stderr || "", 4000);
  return [
    `run_command result: ${command.commandId}`,
    `cwd: ${result?.cwd || command.cwd || ""}`,
    `exitCode: ${result?.exitCode ?? ""}`,
    "stdout:",
    stdout || "(empty)",
    "stderr:",
    stderr || "(empty)"
  ].join("\n");
}

function taskTool(context, { name, label, description, parameters, toCommand }) {
  const { defineTool } = context.sdkExports;
  return defineTool({
    name,
    label,
    description,
    parameters,
    async execute(callId, params = {}) {
      const command = toCommand(params);
      if (command.type === "agent.complete_task" && !command.finalText) {
        command.finalText = context.getLastAssistantText?.() || "";
      }
      await context.onEvent?.({ type: "agent.tool_call", tool: name, callId, command });
      try {
        const result = await context.executeCommand(command);
        const content = formatToolResultContent(name, command, result);
        const details = compactWorkflowResult(result);
        await context.onEvent?.({ type: "agent.tool_result", tool: name, callId, commandId: command.commandId, ok: result?.ok ?? true, content, details, resultRef: { commandId: command.commandId } });
        return { content: [{ type: "text", text: content }], details };
      } catch (error) {
        await context.onEvent?.({ type: "agent.tool_result", tool: name, callId, commandId: command.commandId, ok: false, error: safeError(error) });
        throw error;
      }
    }
  });
}

export function buildTaskAgentTools(context, { allowedTools } = {}) {
  const allowed = new Set(allowedTools || []);
  const include = (tool) => !allowedTools || allowed.has(tool.name);
  const base = (type, extra = {}) => ({
    type,
    commandId: commandIdFor(type.replace("agent.", "").replace("task.", ""), context.taskId),
    taskId: context.taskId,
    runId: context.runId,
    ...extra
  });

  return [
    taskTool(context, {
      name: "complete_task",
      label: "Complete task",
      description: "Complete the current task or move it to the next workflow role.",
      parameters: TObject({ nextColumn: TOptional(TString({ default: "validate" })), summary: TOptional(TString()) }),
      toCommand: (params) => base("agent.complete_task", { nextColumn: params.nextColumn || "validate", summary: params.summary || "" })
    }),
    taskTool(context, {
      name: "request_user_input",
      label: "Request user input",
      description: "Pause the task and ask the human user for required input.",
      parameters: TObject({ question: TString() }),
      toCommand: (params) => base("agent.request_user_input", { question: params.question })
    }),
    taskTool(context, {
      name: "report_blocker",
      label: "Report problem",
      description: "Report a problem and send the task back to manager triage.",
      parameters: TObject({ blocker: TString({ description: "Problem description" }) }),
      toCommand: (params) => base("agent.report_blocker", { blocker: params.blocker })
    }),
    taskTool(context, {
      name: "emit_artifact",
      label: "Emit artifact",
      description: "Persist an artifact under the current task only when the final content is medium or longer, or when the user explicitly asks for an artifact. For short final content, respond directly in chat.",
      parameters: TObject({ path: TString(), content: TString() }),
      toCommand: (params) => base("agent.emit_artifact", { path: params.path, content: params.content || "" })
    }),
    taskTool(context, {
      name: "create_task_spec",
      label: "Create task spec",
      description: "Create the official Product task-spec.md artifact.",
      parameters: TObject({ kind: TOptional(TString({ default: "full" })), content: TString() }),
      toCommand: (params) => base("workflow.create_task_spec", { kind: params.kind === "mini" ? "mini" : "full", content: params.content || "" })
    }),
    taskTool(context, {
      name: "update_task_spec",
      label: "Update task spec",
      description: "Update task-spec.md when Product changes the contract.",
      parameters: TObject({ content: TString(), reason: TOptional(TString()) }),
      toCommand: (params) => base("workflow.update_task_spec", { content: params.content || "", reason: params.reason || "" })
    }),
    taskTool(context, {
      name: "approve_task_spec",
      label: "Approve task spec",
      description: "Approve task-spec.md and return the task to Manager for Definition of Ready.",
      parameters: TObject({ approvedByRole: TOptional(TString({ default: "product" })), summary: TString() }),
      toCommand: (params) => base("workflow.approve_task_spec", { approvedByRole: params.approvedByRole || context.role || "product", summary: params.summary || "" })
    }),
    taskTool(context, {
      name: "record_handoff",
      label: "Record handoff",
      description: "Persist a structured handoff between workflow roles.",
      parameters: TObject({
        fromRole: TOptional(TString()),
        toRole: TString(),
        reason: TOptional(TString()),
        context: TOptional(TString()),
        artifacts: TOptional(TArray(TString())),
        decisions: TOptional(TArray(TString())),
        openQuestions: TOptional(TArray(TString())),
        successCriteria: TOptional(TArray(TString())),
        restrictions: TOptional(TArray(TString())),
        nextAction: TOptional(TString())
      }),
      toCommand: (params) => base("workflow.record_handoff", {
        fromRole: params.fromRole || context.role || context.agentId,
        toRole: params.toRole,
        reason: params.reason || "",
        context: params.context || "",
        artifacts: params.artifacts || [],
        decisions: params.decisions || [],
        openQuestions: params.openQuestions || [],
        successCriteria: params.successCriteria || [],
        restrictions: params.restrictions || [],
        nextAction: params.nextAction || ""
      })
    }),
    taskTool(context, {
      name: "record_decision",
      label: "Record decision",
      description: "Append a workflow decision to decision-log.md.",
      parameters: TObject({ role: TOptional(TString()), decision: TString(), rationale: TOptional(TString()), confirmedBy: TOptional(TString()) }),
      toCommand: (params) => base("workflow.record_decision", { role: params.role || context.role || context.agentId, decision: params.decision || "", rationale: params.rationale || "", confirmedBy: params.confirmedBy })
    }),
    taskTool(context, {
      name: "record_validation",
      label: "Record validation",
      description: "Write validation-report.md with acceptance-criterion-to-evidence mapping.",
      parameters: TObject({ criteria: TOptional(TArray(TString())), summary: TOptional(TString()), evidence: TOptional(TArray(TString())) }),
      toCommand: (params) => base("workflow.record_validation", { criteria: params.criteria || [], summary: params.summary || "", evidence: params.evidence || [] })
    }),
    taskTool(context, {
      name: "record_technical_plan",
      label: "Record technical plan",
      description: "Write the formal technical-plan.md artifact required before complex technical execution.",
      parameters: TObject({ summary: TOptional(TString()), content: TString(), required: TOptional({ type: "boolean" }) }),
      toCommand: (params) => base("workflow.record_technical_plan", { summary: params.summary || "", content: params.content || "", required: params.required !== false })
    }),
    taskTool(context, {
      name: "record_implementation_tasks",
      label: "Record implementation tasks",
      description: "Write implementation-tasks.md with execution steps or subtask mapping.",
      parameters: TObject({ tasks: TOptional(TArray(TString())), content: TOptional(TString()) }),
      toCommand: (params) => base("workflow.record_implementation_tasks", { tasks: params.tasks || [], content: params.content || "" })
    }),
    taskTool(context, {
      name: "record_review_report",
      label: "Record review report",
      description: "Write review-report.md with review status, findings, and evidence.",
      parameters: TObject({ status: TOptional(TString({ default: "passed" })), summary: TOptional(TString()), findings: TOptional(TArray(TString())), evidence: TOptional(TArray(TString())) }),
      toCommand: (params) => base("workflow.record_review_report", { status: ["failed", "not_applicable"].includes(params.status) ? params.status : "passed", summary: params.summary || "", findings: params.findings || [], evidence: params.evidence || [] })
    }),
    taskTool(context, {
      name: "record_deployment_report",
      label: "Record deployment report",
      description: "Write deployment-report.md with delivery status or an explicit not-applicable decision.",
      parameters: TObject({ status: TOptional(TString({ default: "passed" })), summary: TOptional(TString()), environment: TOptional(TString()), version: TOptional(TString()), evidence: TOptional(TArray(TString())) }),
      toCommand: (params) => base("workflow.record_deployment_report", { status: ["failed", "not_applicable"].includes(params.status) ? params.status : "passed", summary: params.summary || "", environment: params.environment || "", version: params.version || "", evidence: params.evidence || [] })
    }),
    taskTool(context, {
      name: "record_summary",
      label: "Record summary",
      description: "Write summary.md before Manager runs Definition of Done.",
      parameters: TObject({ summary: TString(), evidence: TOptional(TArray(TString())) }),
      toCommand: (params) => base("workflow.record_summary", { summary: params.summary || "", evidence: params.evidence || [] })
    }),
    taskTool(context, {
      name: "run_definition_of_ready_gate",
      label: "Run Definition of Ready",
      description: "Run the Manager Definition of Ready gate before Engineering.",
      parameters: TObject({}),
      toCommand: () => base("workflow.run_definition_of_ready_gate")
    }),
    taskTool(context, {
      name: "run_definition_of_done_gate",
      label: "Run Definition of Done",
      description: "Run the Manager Definition of Done gate before Done.",
      parameters: TObject({}),
      toCommand: () => base("workflow.run_definition_of_done_gate")
    }),
    taskTool(context, {
      name: "spawn_subtasks",
      label: "Spawn subtasks",
      description: "Create DAG subtasks for the current master task.",
      parameters: TObject({
        subtasks: TArray(TObject({
          title: TString(),
          description: TOptional(TString({ description: "Self-contained work request for this subtask." })),
          expectedOutput: TOptional(TString({ description: "Concrete output this subtask must produce." })),
          acceptanceCriteria: TOptional(TArray(TString({ description: "Verifiable acceptance criterion for this subtask." }))),
          needs: TOptional(TArray(TString())),
          provides: TOptional(TArray(TString())),
          fileLocks: TOptional(TArray(TString())),
          role: TString({ description: "Canonical role that must execute this subtask: product, design, architecture, engineering, quality, review, deployment, documentation, generalist, manager, etc." }),
          agentId: TOptional(TString({ description: "Legacy alias; use role for new subtasks." }))
        }), { minItems: 1 })
      }),
      toCommand: (params) => base("task.decompose", { subtasks: params.subtasks })
    }),
    taskTool(context, {
      name: "review_subtask",
      label: "Review subtask",
      description: "Approve or reject a child subtask that is waiting_review.",
      parameters: TObject({
        taskId: TString({ description: "Child subtask ID to review." }),
        decision: TString({ description: "approve or reject" }),
        feedback: TOptional(TString({ description: "Feedback for rejection or approval note." }))
      }),
      toCommand: (params) => ({
        type: "subtask.review",
        commandId: commandIdFor("subtask.review", params.taskId || context.taskId),
        taskId: params.taskId,
        decision: params.decision === "reject" ? "reject" : "approve",
        feedback: params.feedback || ""
      })
    }),
    taskTool(context, {
      name: "answer_subtask_question",
      label: "Answer subtask question",
      description: "Send an answer from the parent manager to a child subtask waiting_response.",
      parameters: TObject({
        taskId: TString({ description: "Child subtask ID waiting for response." }),
        answer: TString({ description: "Answer that should resume the subtask." })
      }),
      toCommand: (params) => ({
        type: "subtask.answer_question",
        commandId: commandIdFor("subtask.answer_question", params.taskId || context.taskId),
        taskId: params.taskId,
        answer: params.answer || ""
      })
    }),
    taskTool(context, {
      name: "run_command",
      label: "Run command",
      description: "Run a validation or evidence-gathering command in the task worktree and return stdout/stderr without changing task status.",
      parameters: TObject({
        command: TString({ description: "Executable to run. Use 'sh' with args ['-lc', '...'] when the command needs pipes, redirects, globbing, or multiple shell commands." }),
        args: TOptional(TArray(TString({ description: "Process arguments. Do not pass shell operators like | or > here unless command is 'sh' and args starts with '-lc'." }))),
        cwd: TOptional(TString({ description: "Use 'worktree' for the task worktree or omit for worktree/default root.", default: "worktree" })),
        timeoutMs: TOptional(TNumber({ description: "Timeout in milliseconds.", default: 120000 }))
      }),
      toCommand: (params) => base("agent.run_command", {
        command: params.command,
        args: params.args || [],
        cwd: params.cwd || "worktree",
        ...(params.timeoutMs === undefined ? {} : { timeoutMs: Math.min(params.timeoutMs, 120000) })
      })
    }),
    taskTool(context, {
      name: "wait_for_persona",
      label: "Wait for persona",
      description: "Route the task to another persona and wait for its artifact.",
      parameters: TObject({ targetRole: TString(), question: TString(), expectedArtifact: TOptional(TString()) }),
      toCommand: (params) => base("agent.wait_for_persona", { targetRole: params.targetRole, question: params.question, expectedArtifact: params.expectedArtifact })
    }),
    taskTool(context, {
      name: "wait_for_human",
      label: "Wait for human",
      description: "Route the task to human wait with a question.",
      parameters: TObject({ question: TString(), options: TOptional(TArray(TString())) }),
      toCommand: (params) => base("agent.wait_for_human", { question: params.question, options: params.options || [] })
    }),
    taskTool(context, {
      name: "delegate_task",
      label: "Delegate task",
      description: "Delegate the task to another persona.",
      parameters: TObject({ toPersona: TString(), request: TString(), wait: TOptional({ type: "boolean" }), expectedOutput: TOptional(TString()) }),
      toCommand: (params) => base("agent.delegate_task", { fromPersona: context.role || context.agentId, toPersona: params.toPersona, request: params.request, wait: Boolean(params.wait), expectedOutput: params.expectedOutput })
    }),
    taskTool(context, {
      name: "review_task",
      label: "Review task",
      description: "Record review findings and pass or fail the review gate.",
      parameters: TObject({ findings: TOptional(TArray(TObject({ severity: TOptional(TString()), message: TOptional(TString()) }))), evidence: TOptional(TArray(TString())) }),
      toCommand: (params) => base("agent.review_task", { findings: params.findings || [], evidence: params.evidence || [] })
    }),
    taskTool(context, {
      name: "deploy_task",
      label: "Deploy task",
      description: "Run and record deployment evidence.",
      parameters: TObject({ command: TString(), args: TOptional(TArray(TString())), rollback: TOptional(TString()) }),
      toCommand: (params) => base("agent.deploy_task", { command: params.command, args: params.args || [], rollback: params.rollback || "" })
    })
  ].filter(include);
}

// ---------------------------------------------------------------------------
// Board assistant agent — runs a real Pi SDK session with kanban tools.
// ---------------------------------------------------------------------------

export async function runBoardAssistant({ prompt, agentId = "assistant", instructions, root, context }) {
  logStep("pi-adapter", "runBoardAssistant.start", { agentId });
  const resolvedRoot = root || join(homedir(), ".kanban-code-agent");
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    logStep("pi-adapter", "runBoardAssistant.fallback", { agentId, reason: loaded.reason });
    return { ok: false, reply: `Pi SDK indisponível (${loaded.reason}). Usando fallback determinístico.` };
  }

  const sdk = loaded.sdk;
  if (!canUseSdk(sdk)) {
    logStep("pi-adapter", "runBoardAssistant.unsupported", { agentId });
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
    const systemContext = [
      instructions || "Você é o assistente do Kanban Code Agent. Responda em português brasileiro.",
      AGENT_RESPONSE_POLICY,
      "Use as ferramentas kca_* para gerenciar tasks, colunas e configurações. Ao criar task, o único requisito é entender o pedido do usuário: se a coluna não for informada, use entrada/inbox; não peça prioridade nem tipo; se o texto for descrição, infira um título; se o pedido depender de referência subjetiva sem contexto, peça clarificação objetiva."
    ].join("\n\n");
    const timeoutMs = Number(process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS || 15000);
    let timeoutId;
    try {
      await Promise.race([
        session.prompt(`${systemContext}\n\n${prompt}`, { source: "sdk" }),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`board_assistant_timeout:${timeoutMs}`)), timeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    const reply = lastAssistantText || "Processado sem resposta textual.";
    logStep("pi-adapter", "runBoardAssistant.done", { agentId });
    return { ok: true, reply, modelFallbackMessage, agentId };
  } catch (error) {
    logStep("pi-adapter", "runBoardAssistant.error", { agentId, reason: safeError(error) });
    if (String(safeError(error)).startsWith("board_assistant_timeout:")) {
      return { ok: false, reply: `Tempo esgotado ao consultar o agent (${process.env.KCA_BOARD_ASSISTANT_TIMEOUT_MS || 15000}ms). Tente uma pergunta mais específica ou ajuste KCA_BOARD_ASSISTANT_TIMEOUT_MS.`, timeout: true };
    }
    return { ok: false, reply: `Erro no agente: ${safeError(error)}` };
  } finally {
    unsubscribe?.();
    session.dispose?.();
  }
}

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function firstAssistantText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) return contentText(message.content);
  return "";
}

export async function startOpenAICompatibleSession({ providerConfig, model, task, agentId, role, runId, cwd, prompt, customToolFactory, onEvent, maxTurns = 12, fetchImpl = globalThis.fetch }) {
  const baseUrl = providerConfig?.baseUrl?.replace(/\/$/, "");
  const apiKey = providerConfig?.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : null;
  if (!fetchImpl) return { mode: "failed", provider: providerConfig?.id, reason: "fetch_unavailable", sessionId: runId, cwd };
  if (!baseUrl || !apiKey || !model) return { mode: "failed", provider: providerConfig?.id, reason: "provider_not_configured", sessionId: runId, cwd };

  const sdkExports = { defineTool: (tool) => tool };
  let lastAssistantText = "";
  const customTools = await customToolFactory?.({ sdkExports, getLastAssistantText: () => lastAssistantText }) || [];
  const toolMap = new Map(customTools.map((tool) => [tool.name, tool]));
  const messages = [{ role: "user", content: String(prompt || task?.title || "") }];
  const events = [];
  const terminalTools = new Set(["complete_task", "request_user_input", "report_blocker", "spawn_subtasks", "wait_for_persona", "wait_for_human", "delegate_task", "review_task", "review_subtask", "answer_subtask_question", "deploy_task", "create_task_spec", "approve_task_spec", "record_handoff", "record_decision", "record_validation", "record_technical_plan", "record_implementation_tasks", "record_review_report", "record_deployment_report", "record_summary", "run_definition_of_ready_gate", "run_definition_of_done_gate"]);
  let promptSent = false;
  let terminal = false;
  const contextWindow = modelContextWindow(providerConfig, model);
  const requestTimeoutMs = providerRequestTimeoutMs(providerConfig);

  for (let turn = 0; turn < maxTurns && !terminal; turn += 1) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
    if (process.env.OPENROUTER_APP_TITLE) headers["X-Title"] = process.env.OPENROUTER_APP_TITLE;
    promptSent = true;
    let response;
    try {
      response = await fetchWithTimeout(fetchImpl, `${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages,
          tools: toolsToOpenAI(customTools),
          tool_choice: customTools.length ? "auto" : undefined
        })
      }, requestTimeoutMs);
    } catch (error) {
      const reason = error?.code === "request_timeout" ? "request_timeout" : `request_error:${safeError(error)}`;
      return { mode: "failed", provider: providerConfig.id, reason, sessionId: runId, cwd, promptSent, timeoutMs: requestTimeoutMs };
    }
    if (!response.ok) {
      return { mode: "failed", provider: providerConfig.id, reason: `http_${response.status}`, sessionId: runId, cwd, promptSent };
    }
    const data = await response.json();
    const usage = normalizeProviderUsage(data?.usage, { contextWindow });
    if (usage) {
      const event = { type: "agent.usage", category: "usage", agentId, role, provider: providerConfig.id, model: data?.model || model, responseId: data?.id, usage };
      events.push(event);
      await onEvent?.(event);
    }
    const message = data?.choices?.[0]?.message || {};
    const text = firstAssistantText(message);
    if (text) {
      lastAssistantText = text;
      const event = { type: "agent.transcript", category: "message", role: "assistant", text, providerEvent: { id: data.id, model: data.model } };
      events.push(event);
      await onEvent?.(event);
    }
    messages.push({ role: "assistant", content: message.content || "", tool_calls: message.tool_calls || undefined });
    const toolCalls = message.tool_calls || [];
    if (!toolCalls.length) {
      return { mode: "real", provider: providerConfig.id, version: "openai-compatible", sessionId: runId, cwd, promptSent, terminal: false, reason: "non_terminal_response", events };
    }
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name || toolCall.name;
      const tool = toolMap.get(toolName);
      const callId = toolCall.id || `call_${turn}_${toolName}`;
      let content = `Unknown tool: ${toolName}`;
      try {
        if (!tool) throw new Error(content);
        const result = await tool.execute(callId, parseToolArguments(toolCall.function?.arguments || toolCall.arguments));
        content = contentText(result.content) || JSON.stringify(result.details || result || {});
        terminal = terminal || terminalTools.has(toolName);
      } catch (error) {
        content = safeError(error);
      }
      messages.push({ role: "tool", tool_call_id: callId, content: truncate(content, 12000) });
    }
  }

  return { mode: "real", provider: providerConfig.id, version: "openai-compatible", sessionId: runId, cwd, promptSent, terminal, reason: terminal ? undefined : "max_turns_without_terminal", events };
}

// ---------------------------------------------------------------------------
// Legacy — kept for task-session tests and orchestrator dry-runs.
// ---------------------------------------------------------------------------

export async function startPiSession({ task, agentId, runId, cwd, prompt, sessionDir, agentDir, previousSessionFile, tools = [], customTools = [], customToolFactory, runPrompt = false, onEvent }) {
  logStep("pi-adapter", "startPiSession.start", { taskId: task.id, agentId, runId, runPrompt });
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    logStep("pi-adapter", "startPiSession.fake", { taskId: task.id, agentId, runId, reason: loaded.reason });
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
    logStep("pi-adapter", "startPiSession.unsupported", { taskId: task.id, agentId, runId });
    return { mode: "real", provider: loaded.packageName, version: loaded.version, sessionId: runId, warning: "Pi SDK loaded without createAgentSession/SessionManager" };
  }

  const sessionTimeoutMs = Number(process.env.KCA_PI_SESSION_TIMEOUT_MS || 2500);
  let sessionTimeoutId;
  let lastAssistantText = "";
  const sessionTimeout = new Promise((resolve) => {
    sessionTimeoutId = setTimeout(() => resolve({
      mode: "fake",
      provider: loaded.packageName,
      version: loaded.version,
      reason: "session_timeout",
      sessionId: runId,
      previousSessionFile,
      cwd,
      promptPreview: String(prompt || task.title || "").slice(0, 160)
    }), sessionTimeoutMs);
    sessionTimeoutId.unref?.();
  });
  const realSession = (async () => {
    logStep("pi-adapter", "startPiSession.real", { taskId: task.id, agentId, runId });
    const sessionManager = sdk.SessionManager.create(cwd || process.cwd(), sessionDir);
    const resolvedCustomTools = typeof customToolFactory === "function"
      ? await customToolFactory({ sdkExports: sdk, getLastAssistantText: () => lastAssistantText })
      : customTools;
    const { session, modelFallbackMessage } = await sdk.createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      customTools: resolvedCustomTools,
      tools: tools.length ? tools : undefined,
      noTools: tools.length ? undefined : "builtin",
      sessionStartEvent: {
        type: "session_start",
        reason: previousSessionFile ? "resume" : "new",
        previousSessionFile
      }
    });
    return { session, sessionManager, modelFallbackMessage, resolvedCustomTools };
  })();
  const created = await Promise.race([realSession, sessionTimeout]);
  clearTimeout(sessionTimeoutId);
  if (created.reason === "session_timeout") {
    logStep("pi-adapter", "startPiSession.done", { taskId: task.id, agentId, runId, mode: created.mode, reason: created.reason });
    return created;
  }

  const { session, sessionManager, modelFallbackMessage, resolvedCustomTools } = created;
  const events = [];
  const seenTranscript = new Set();
  const unsubscribe = session.subscribe((event) => {
    const normalized = normalizeSessionEvent(event);
    if (normalized.category === "message" && normalized.role === "assistant" && normalized.text) {
      lastAssistantText = normalized.text;
    }
    const signature = [normalized.category, normalized.role || "", normalized.text || "", normalized.toolCall?.id || "", normalized.toolResult?.id || ""].join("\u0001");
    if (seenTranscript.has(signature)) return;
    seenTranscript.add(signature);
    events.push({ type: event.type, category: normalized.category, role: normalized.role, text: normalized.text, ts: new Date().toISOString() });
    if (normalized.text || normalized.category !== "event") void onEvent?.(normalized);
  });
  let promptSent = false;
  let result;
  try {
    session.setSessionName?.(`${task.id}:${agentId}`);
    if (runPrompt) {
      const promptTimeoutMs = Number(process.env.KCA_TASK_AGENT_TIMEOUT_MS || 600000);
      let promptTimeoutId;
      const promptTimeout = new Promise((resolve) => {
        promptTimeoutId = setTimeout(() => resolve({ reason: "prompt_timeout" }), promptTimeoutMs);
        promptTimeoutId.unref?.();
      });
      const promptResult = await Promise.race([
        session.prompt(String(prompt || task.title || ""), {
          source: "sdk",
          preflightResult: (success) => { promptSent = success; }
        }).then(() => ({ ok: true })),
        promptTimeout
      ]);
      clearTimeout(promptTimeoutId);
      if (promptResult.reason === "prompt_timeout") {
        result = {
          mode: "real",
          provider: loaded.packageName,
          version: loaded.version,
          reason: "prompt_timeout",
          sessionId: session.sessionId || sessionManager.getSessionId?.() || runId,
          sessionFile: session.sessionFile || sessionManager.getSessionFile?.(),
          previousSessionFile,
          cwd,
          promptPreview: String(prompt || task.title || "").slice(0, 160),
          promptSent,
          activeTools: session.getActiveToolNames?.() || resolvedCustomTools.map((tool) => tool.name),
          modelFallbackMessage,
          events
        };
        return result;
      }
      promptSent = true;
    }
    result = {
      mode: "real",
      provider: loaded.packageName,
      version: loaded.version,
      sessionId: session.sessionId || sessionManager.getSessionId?.() || runId,
      sessionFile: session.sessionFile || sessionManager.getSessionFile?.(),
      previousSessionFile,
      cwd,
      promptPreview: String(prompt || task.title || "").slice(0, 160),
      promptSent: Boolean(runPrompt) ? promptSent : false,
      activeTools: session.getActiveToolNames?.() || resolvedCustomTools.map((tool) => tool.name),
      modelFallbackMessage,
      events
    };
    return result;
  } finally {
    unsubscribe?.();
    session.dispose?.();
    logStep("pi-adapter", "startPiSession.done", { taskId: task.id, agentId, runId, mode: result?.mode, reason: result?.reason });
  }
}

export async function doctorPi({ cwd = process.cwd(), sessionDir, runPrompt = false } = {}) {
  logStep("pi-adapter", "doctorPi.start", { cwd, runPrompt });
  const loaded = await loadPiSdk();
  if (!loaded.ok) {
    logStep("pi-adapter", "doctorPi.done", { ok: false, reason: loaded.reason });
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

  const result = {
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
  logStep("pi-adapter", "doctorPi.done", { ok: result.ok });
  return result;
}
