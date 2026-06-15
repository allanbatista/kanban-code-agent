import { constants } from "node:fs";
import { access, appendFile, mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { DEFAULT_AI_SETTINGS, fetchOpenRouterModels } from "@kca/core/providers";
import { DEFAULT_ROLES } from "@kca/core/roles";
import { logStep } from "@kca/core/log";
import YAML from "yaml";

export const DEFAULT_COLUMNS = ["inbox", "manager", "product", "design", "architecture", "generalist", "engineering", "quality", "review", "deployment", "human_wait", "done"];
const storageInitCache = new Map();

const DEFAULT_COLUMN_META = {
  inbox: { label: "Entrada", agent: "assistant", autoStart: false, wip: null },
  manager: { label: "Manager", agent: "manager", role: "manager", autoStart: true, wip: 2 },
  product: { label: "Produto", agent: "product", role: "product", autoStart: true, wip: null },
  design: { label: "Design", agent: "design", role: "design", autoStart: true, wip: null },
  architecture: { label: "Arquitetura", agent: "architecture", role: "architecture", autoStart: true, wip: 2 },
  generalist: { label: "Generalista", agent: "generalist", role: "generalist", autoStart: true, wip: 3 },
  engineering: { label: "Engenharia", agent: "engineering", role: "engineering", autoStart: true, wip: 4 },
  quality: { label: "Qualidade", agent: "quality", role: "quality", autoStart: true, wip: 2 },
  review: { label: "Review", agent: "review", role: "review", autoStart: true, wip: 2 },
  deployment: { label: "Deployment", agent: "deployment", role: "deployment", autoStart: false, wip: 1 },
  human_wait: { label: "Aguardando Humano", agent: null, role: "manager", autoStart: false, wip: null },
  done: { label: "Pronto", agent: null, role: null, autoStart: false, wip: null }
};

const COLUMN_ALIASES = { definition: "product", build: "engineering", validate: "quality", blocked: "human_wait", deploy: "deployment" };
const WORKFLOW_GATE_KEYS = ["spec", "clarification", "definitionOfReady", "validation", "definitionOfDone"];
const DEFAULT_WORKFLOW_SETTINGS = {
  requireSpec: true,
  allowMiniSpec: true,
  requireTechnicalPlanForCode: true,
  requireQaBeforeReview: true,
  requireReviewBeforeDone: true,
  requireDeploymentEvidence: true,
  requireDocumentationDecision: true,
  requireSummaryBeforeDone: true,
  requireUserSpecApproval: false,
  preventAutomaticDeployDone: true,
  sandboxPolicy: "prompt_only",
  retryPolicy: { maxAttempts: 2, timeoutMs: 120000 }
};

export function normalizeColumnId(columnId) {
  return COLUMN_ALIASES[columnId] || columnId;
}

function emptyWorkflowGate(status = "pending", reason = "", evidence = []) {
  return { status, reason, evidence };
}

function workflowRoleForColumn(column, routing = {}) {
  if (routing.currentRole) return routing.currentRole;
  if (routing.currentAgent && routing.currentAgent !== "assistant") return routing.currentAgent;
  const map = {
    inbox: "manager",
    manager: "manager",
    product: "product",
    design: "design",
    architecture: "architecture",
    generalist: "generalist",
    engineering: "engineering",
    quality: "qa",
    review: "review",
    deployment: "deployment",
    human_wait: "manager",
    done: "none"
  };
  return map[column] || "manager";
}

function workflowPhaseForTask(task) {
  if (task.status === "done" || task.column === "done") return "done";
  if (task.status === "blocked" || task.column === "human_wait") return "blocked";
  if (task.status === "canceled") return "cancelled";
  const map = {
    inbox: "intake",
    manager: "intake",
    product: "spec",
    design: "planning",
    architecture: "planning",
    generalist: "execution",
    engineering: "execution",
    quality: "validation",
    review: "review",
    deployment: "delivery"
  };
  return map[task.column] || "intake";
}

function normalizeWorkflow(task) {
  const workflow = task.workflow || {};
  const gates = { ...(workflow.gates || {}) };
  for (const key of WORKFLOW_GATE_KEYS) gates[key] = { ...emptyWorkflowGate(), ...(gates[key] || {}) };
  return {
    phase: workflow.phase || workflowPhaseForTask(task),
    currentRole: workflow.currentRole || workflowRoleForColumn(task.column, task.routing),
    boardColumn: workflow.boardColumn || task.column || "manager",
    gates,
    artifacts: {
      taskSpec: "task-spec.md",
      acceptance: "acceptance.md",
      technicalPlan: "technical-plan.md",
      implementationTasks: "implementation-tasks.md",
      validationReport: "validation-report.md",
      reviewReport: "review-report.md",
      deploymentReport: "deployment-report.md",
      summary: "summary.md",
      decisionLog: "decision-log.md",
      handoffsDir: "handoffs",
      ...(workflow.artifacts || {})
    },
    ...Object.fromEntries(Object.entries(workflow).filter(([key]) => !["phase", "currentRole", "boardColumn", "gates", "artifacts"].includes(key)))
  };
}

function draftTaskSpec(task, description = "") {
  return [
    "# Task Spec",
    "",
    "Status: draft",
    "",
    "## Request",
    "",
    description.trim() || task.title || "Pending request details.",
    "",
    "## Scope",
    "",
    "- TBD",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] TBD",
    "",
    "## Dependencies",
    "",
    "- None recorded.",
    "",
    "## Blocking Questions",
    "",
    "- None recorded.",
    ""
  ].join("\n");
}

async function ensureWorkflowArtifacts(taskDir, task, description = "") {
  if (task.status === "draft") return;
  await ensureFile(join(taskDir, "task-spec.md"), draftTaskSpec(task, description));
}

function patchWithWorkflow(current, patch = {}) {
  const projected = { ...current, ...patch };
  const workflow = normalizeWorkflow(projected);
  workflow.boardColumn = patch.column || workflow.boardColumn || projected.column;
  if (patch.status === "done" || patch.column === "done") {
    workflow.phase = "done";
    workflow.currentRole = "none";
    workflow.boardColumn = "done";
  } else if (patch.column && !patch.workflow) {
    workflow.phase = workflowPhaseForTask(projected);
    workflow.currentRole = workflowRoleForColumn(patch.column, projected.routing);
  }
  return { ...patch, workflow: { ...workflow, ...(patch.workflow || {}) } };
}

async function resolveStoredColumnId(columnId, p) {
  const requested = columnId || "manager";
  const board = await readYaml(join(p.settings, "boards", "default.yaml"), { columns: [] });
  const ids = new Set((board.columns || []).map((column) => column.id));
  return ids.has(requested) ? requested : normalizeColumnId(requested);
}

export function storageRoot(root = process.env.KCA_STORAGE_ROOT) {
  return resolve(root || join(homedir(), ".kanban-code-agent"));
}

export function paths(rootInput) {
  const root = storageRoot(rootInput);
  return {
    root,
    settings: join(root, "settings"),
    tasks: join(root, "tasks"),
    runtime: join(root, "settings", "runtime")
  };
}

export async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeAtomic(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, content);
  await rename(temp, path);
}

export async function writeYaml(path, value) {
  await writeAtomic(path, YAML.stringify(value));
}

export async function ensureYaml(path, value) {
  if (!(await exists(path))) await writeYaml(path, value);
}

export async function ensureFile(path, content) {
  if (!(await exists(path))) await writeAtomic(path, content);
}

async function ensureAgentMaxParallelTasks(path, maxParallelTasks = 50) {
  const agent = await readYaml(path, null);
  if (!agent || agent.limits?.maxParallelTasks !== undefined) return;
  await writeYaml(path, {
    ...agent,
    limits: { ...(agent.limits || {}), maxParallelTasks }
  });
}

export async function readYaml(path, fallback = null) {
  try {
    return YAML.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function defaultColumnSettings(id) {
  const meta = DEFAULT_COLUMN_META[id];
  return { id, label: meta.label, agent: meta.agent, role: meta.role, autoStart: meta.autoStart, wip: meta.wip, wipLimit: meta.wip, hooks: { onEnter: id === "human_wait" ? ["summarize-blocker"] : id === "quality" ? ["run-checks"] : [], beforeLeave: [], onAgentComplete: [] } };
}

async function ensureDefaultBoardColumns(boardPath) {
  const board = await readYaml(boardPath, null);
  if (!board || !Array.isArray(board.columns)) return;
  const columns = [...board.columns];
  let changed = false;
  for (const id of DEFAULT_COLUMNS) {
    if (columns.some((column) => column.id === id)) continue;
    const previousDefault = DEFAULT_COLUMNS[DEFAULT_COLUMNS.indexOf(id) - 1];
    const previousIndex = previousDefault ? columns.findIndex((column) => column.id === previousDefault) : -1;
    columns.splice(previousIndex >= 0 ? previousIndex + 1 : columns.length, 0, defaultColumnSettings(id));
    changed = true;
  }
  if (changed) await writeYaml(boardPath, { ...board, columns });
}

async function ensureAgentTool(agentPath, toolName) {
  const agent = await readYaml(agentPath, null);
  if (!agent || !Array.isArray(agent.tools) || agent.tools.includes(toolName)) return;
  await writeYaml(agentPath, { ...agent, tools: [...agent.tools, toolName] });
}

async function ensurePromptContains(promptPath, expectedText, amendment) {
  let current = "";
  try {
    current = await readFile(promptPath, "utf8");
  } catch {
    return;
  }
  if (current.includes(expectedText)) return;
  await writeAtomic(promptPath, `${current.trimEnd()}\n\n${amendment.trim()}\n`);
}

async function ensureAppDefaults(appPath) {
  const app = await readYaml(appPath, null);
  if (!app) return;
  const next = {
    ...app,
    ai: app.ai || DEFAULT_AI_SETTINGS,
    workflow: { ...DEFAULT_WORKFLOW_SETTINGS, ...(app.workflow || {}), retryPolicy: { ...DEFAULT_WORKFLOW_SETTINGS.retryPolicy, ...(app.workflow?.retryPolicy || {}) } }
  };
  if (JSON.stringify(app) === JSON.stringify(next)) return;
  await writeYaml(appPath, next);
}

async function readSkillMarkdown(skillDir, id) {
  try {
    const body = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const match = body.match(/^---\n([\s\S]*?)\n---\n?/);
    const frontmatter = match ? YAML.parse(match[1]) || {} : {};
    return { schema: "kanban-code-agent/skill@1", id, instructionsPath: "SKILL.md", body, ...frontmatter };
  } catch {
    return null;
  }
}

export async function appendJsonl(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export async function readJsonl(path) {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

const UNCLEAR_TASK_TITLE = "Aguardando detalhes da tarefa";
const TASK_INTENT_STOPWORDS = new Set([
  "a", "as", "o", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "para", "por", "com", "sem", "que", "qual", "quais", "como", "quando", "onde", "e", "ou", "se", "me", "eu", "voce",
  "voces", "porfavor", "favor", "preciso", "quero", "gostaria", "deve", "deveria", "fazer", "faz", "isso",
  "isto", "aquilo", "algo", "alguma", "coisa", "coisas", "tarefa", "task", "app", "aplicacao", "sistema", "produto"
]);
const TASK_INTENT_ACTIONS = new Set([
  "adicionar", "ajustar", "alterar", "analisar", "atualizar", "configurar", "construir", "corrigir", "criar",
  "documentar", "explicar", "implementar", "integrar", "investigar", "listar", "melhorar", "migrar", "pesquisar",
  "planejar", "refatorar", "remover", "revisar", "testar", "validar",
  "adicione", "ajuste", "altere", "analise", "atualize", "configure", "construa", "corrija", "crie", "documente",
  "explique", "faca", "implemente", "integre", "investigue", "liste", "melhore", "migre", "pesquise", "planeje",
  "refatore", "remova", "revise", "teste", "valide"
]);

function normalizeIntentToken(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function taskTitleSource(input = {}) {
  const explicit = String(input.title || "").trim();
  if (explicit) return explicit;
  const description = String(input.description || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`[\]()!-]/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (description) return description.slice(0, 80);
  const attachment = Array.isArray(input.attachments) ? input.attachments.find((item) => item?.fileName || item?.name) : null;
  return String(attachment?.fileName || attachment?.name || "Rascunho sem titulo").slice(0, 80);
}

function fallbackTaskTitle(input = {}) {
  return taskTitleSource(input).slice(0, 80);
}

function taskHasActionableIntent(input = {}) {
  if (String(input.title || "").trim() || input.draft) return true;
  const text = normalizeIntentToken(`${input.description || ""} ${input.prompt || ""}`).replace(/[^a-z0-9]+/g, " ");
  const tokens = text.split(/\s+/).filter(Boolean);
  const hasAction = tokens.some((token) => TASK_INTENT_ACTIONS.has(token));
  const concreteTokens = tokens.filter((token) => token.length > 2 && !TASK_INTENT_STOPWORDS.has(token) && !TASK_INTENT_ACTIONS.has(token));
  return hasAction && concreteTokens.length > 0;
}

function safeAttachmentName(fileName) {
  const base = basename(String(fileName || "attachment").replaceAll("\\", "/")).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const safe = base || "attachment";
  const dot = safe.lastIndexOf(".");
  const name = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  return `${name.slice(0, 96)}${ext.slice(0, 24)}`;
}

async function readJsonlReversePage(path, { limit = 50, beforeTs } = {}) {
  const rows = [];
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const chunkSize = 64 * 1024;
    let position = size;
    let carry = "";
    while (position > 0 && rows.length < limit) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      await handle.read(buffer, 0, readSize, position);
      const parts = `${buffer.toString("utf8")}${carry}`.split("\n");
      carry = parts.shift() || "";
      for (let index = parts.length - 1; index >= 0 && rows.length < limit; index -= 1) {
        const line = parts[index].trim();
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          if (beforeTs && row.ts && row.ts >= beforeTs) continue;
          rows.push(row);
        } catch {}
      }
    }
    if (position === 0 && carry.trim() && rows.length < limit) {
      try {
        const row = JSON.parse(carry.trim());
        if (!beforeTs || !row.ts || row.ts < beforeTs) rows.push(row);
      } catch {}
    }
  } catch {
    return [];
  } finally {
    await handle?.close();
  }
  return rows;
}

function shortText(value, max = 260) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function logText(event) {
  if (event.text) return event.text;
  if (event.category === "tool_call" && event.toolCall) return `${event.toolCall.name || event.toolCall.tool || "tool"} ${shortText(event.toolCall.input || event.toolCall.arguments || event.toolCall.params || "", 180)}`;
  if (event.category === "tool_result" && event.toolResult) return shortText(event.toolResult.text || event.toolResult.output || event.toolResult.content || event.toolResult, 220);
  if (event.message?.text) return event.message.text;
  if (event.question) return event.question;
  if (event.blocker) return event.blocker;
  if (event.reason) return event.reason;
  if (event.summary) return event.summary;
  if (event.reply) return event.reply;
  if (event.prompt) return event.prompt;
  if (event.tool) return `${event.tool}${event.ok === undefined ? "" : ` ok=${event.ok}`}`;
  return event.path || event.type || "event";
}

async function taskSessionLogFiles(p, taskId) {
  const base = join(p.runtime, "sessions", taskId);
  const agents = await readdir(base, { withFileTypes: true }).catch(() => []);
  return agents
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ path: join(base, entry.name, "session.jsonl"), source: `session:${entry.name}`, agentId: entry.name }));
}

export async function readAgentLogs(rootInput, { taskId, limit = 50, cursor, agentId, runId } = {}) {
  const p = paths(rootInput);
  logStep("fsdb", "readAgentLogs", { taskId, limit, cursor: cursor || null, agentId: agentId || null, runId: runId || null });
  const files = [
    { path: join(p.tasks, taskId, "events.jsonl"), source: "events" },
    ...await taskSessionLogFiles(p, taskId)
  ].filter((file) => !agentId || !file.agentId || file.agentId === agentId);
  const rows = (await Promise.all(files.map(async (file) => {
    const events = await readJsonlReversePage(file.path, { limit: limit * 3, beforeTs: cursor });
    return events.map((event) => ({ event, file }));
  }))).flat();
  const deduped = [];
  const seen = new Set();
  for (const row of rows
    .filter(({ event }) => !runId || event.runId === runId)
    .sort((a, b) => String(b.event.ts || "").localeCompare(String(a.event.ts || "")))) {
    const { event, file } = row;
    const eventAgent = typeof event.agent === "string" ? event.agent : undefined;
    const signature = [
      event.runId || "",
      event.type || "event",
      event.category || "",
      event.role || "",
      event.actor || eventAgent || file.agentId || "",
      logText(event)
    ].join("\u0001");
    if (seen.has(signature)) continue;
    seen.add(signature);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }
  const items = deduped.map(({ event, file }, index) => {
    const eventAgent = typeof event.agent === "string" ? event.agent : undefined;
    return {
      id: `${file.source}:${event.ts || "no-ts"}:${event.type || "event"}:${index}`,
      ts: event.ts || "",
      source: file.source,
      type: event.type || "event",
      actor: event.actor || eventAgent || file.agentId || "system",
      taskId: event.taskId || taskId,
      agentId: event.agentId || eventAgent || file.agentId,
      runId: event.runId,
      category: event.category,
      role: event.role,
      text: shortText(logText(event)),
      raw: event
    };
  });
  const nextCursor = items.length ? items[items.length - 1].ts : undefined;
  return { items, nextCursor, hasMore: items.length === limit };
}

function usageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function contextUsageTokens(usage) {
  const inputTokens = usageNumber(usage?.inputTokens);
  const outputTokens = usageNumber(usage?.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens || 0) + (outputTokens || 0);
}

function contextPercentForUsage(usage, contextWindow) {
  const tokens = contextUsageTokens(usage);
  return tokens !== undefined && contextWindow ? Math.round((tokens / contextWindow) * 1000) / 10 : undefined;
}

function eventTime(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addUsageMetric(target, key, value) {
  const parsed = usageNumber(value);
  if (parsed === undefined) return;
  target[key] = (target[key] || 0) + parsed;
}

function normalizeUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const inputTokens = usageNumber(rawUsage.inputTokens ?? rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? rawUsage.input);
  const outputTokens = usageNumber(rawUsage.outputTokens ?? rawUsage.output_tokens ?? rawUsage.completion_tokens ?? rawUsage.output);
  const totalTokens = usageNumber(rawUsage.totalTokens ?? rawUsage.total_tokens) ?? (
    inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined
  );
  const cacheReadTokens = usageNumber(
    rawUsage.cacheRead
    ?? rawUsage.cache_read
    ?? rawUsage.cache_read_input_tokens
    ?? rawUsage.prompt_cache_hit_tokens
    ?? rawUsage.prompt_tokens_details?.cached_tokens
    ?? rawUsage.input_tokens_details?.cached_tokens
  );
  const cacheWriteTokens = usageNumber(rawUsage.cacheWrite ?? rawUsage.cache_write ?? rawUsage.cache_creation_input_tokens);
  const cacheTokens = usageNumber(rawUsage.cacheTokens ?? rawUsage.cache_tokens ?? rawUsage.cached_tokens ?? rawUsage.cachedTokens) ?? (
    cacheReadTokens !== undefined || cacheWriteTokens !== undefined ? (cacheReadTokens || 0) + (cacheWriteTokens || 0) : undefined
  );
  const contextWindow = usageNumber(rawUsage.contextWindow ?? rawUsage.context_window);
  const contextPercent = contextWindow
    ? contextPercentForUsage({ inputTokens, outputTokens }, contextWindow)
    : usageNumber(rawUsage.contextPercent ?? rawUsage.context_percent);
  const usage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheTokens !== undefined ? { cacheTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(contextPercent !== undefined ? { contextPercent } : {})
  };
  return Object.keys(usage).length ? usage : null;
}

function runDurations(events = []) {
  const runs = new Map();
  for (const event of events) {
    if (!event?.runId) continue;
    const ts = eventTime(event.ts);
    if (ts === undefined) continue;
    const agentId = event.agentId || event.agent || (event.actor && !["user", "orchestrator", "daemon"].includes(event.actor) ? event.actor : undefined);
    if (!agentId) continue;
    const current = runs.get(event.runId) || { runId: event.runId, agentId, role: event.role || agentId, start: ts, end: ts };
    current.agentId ||= agentId;
    current.role ||= event.role || agentId;
    current.start = Math.min(current.start, ts);
    current.end = Math.max(current.end, ts);
    runs.set(event.runId, current);
  }
  return [...runs.values()].filter((run) => run.end >= run.start);
}

function applyUsageEvent(target, event) {
  const usage = normalizeUsage(event?.usage) || {};
  addUsageMetric(target, "inputTokens", usage.inputTokens);
  addUsageMetric(target, "outputTokens", usage.outputTokens);
  addUsageMetric(target, "totalTokens", usage.totalTokens);
  addUsageMetric(target, "cacheTokens", usage.cacheTokens);
  const contextWindow = usageNumber(usage.contextWindow);
  const contextPercent = usageNumber(usage.contextPercent);
  if (contextWindow !== undefined) target.contextWindow = contextWindow;
  if (contextPercent !== undefined) target.contextPercent = contextPercent;
}

function usageText(value) {
  const text = String(value || "").trim();
  return text || undefined;
}

function runModelEvents(events = []) {
  const runs = new Map();
  for (const event of events) {
    if (event?.type !== "agent.run" || !event.runId) continue;
    runs.set(event.runId, {
      provider: usageText(event.provider),
      model: usageText(event.model),
      effort: usageText(event.effort)
    });
  }
  return runs;
}

function usageModelKey(provider, model) {
  return `${provider || ""}\u0001${model || "n/d"}`;
}

function usageModelTarget(agentUsage, provider, model) {
  if (!agentUsage._models) agentUsage._models = new Map();
  const key = usageModelKey(provider, model);
  const current = agentUsage._models.get(key) || {
    ...(provider ? { provider } : {}),
    model: model || "n/d",
    runs: 0
  };
  agentUsage._models.set(key, current);
  return current;
}

function providerModelsCachePath(rootInput, providerId = "openrouter") {
  return join(paths(rootInput).settings, "provider-models", `${providerId}.json`);
}

export async function readProviderModelsCache(rootInput, providerId = "openrouter") {
  const cache = await readJson(providerModelsCachePath(rootInput, providerId), null);
  return cache && Array.isArray(cache.models) ? cache : null;
}

export async function refreshOpenRouterModelCache(rootInput, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  try {
    const cache = await fetchOpenRouterModels(env, { fetchImpl });
    await writeAtomic(providerModelsCachePath(rootInput, "openrouter"), JSON.stringify(cache, null, 2));
    logStep("fsdb", "providerModels.cache_refreshed", { providerId: "openrouter", models: cache.models.length });
    return { ok: true, cache };
  } catch (error) {
    const cache = await readProviderModelsCache(rootInput, "openrouter");
    logStep("fsdb", "providerModels.cache_refresh_failed", { providerId: "openrouter", error: error.message, stale: Boolean(cache) });
    return { ok: false, error: error.message, cache, stale: Boolean(cache) };
  }
}

function modelTerms(model = {}) {
  const id = usageText(model.id);
  const name = usageText(model.name);
  const shortId = id?.includes("/") ? id.split("/").pop() : undefined;
  return [id, name, shortId].filter(Boolean);
}

function resolveCachedContextWindow(modelCaches = [], provider, model) {
  const needle = usageText(model);
  if (!needle) return undefined;
  const models = modelCaches.flatMap((cache) => Array.isArray(cache?.models) ? cache.models.map((item) => ({ ...item, providerId: cache.providerId })) : []);
  const exact = models.find((item) => modelTerms(item).some((term) => term === needle));
  const suffix = exact || models.find((item) => usageText(item.id)?.endsWith(`/${needle}`));
  return usageNumber(suffix?.contextWindow);
}

function usageEventWithContext(usageEvent, modelCaches, provider, model) {
  const usage = normalizeUsage(usageEvent.usage);
  if (!usage) return usageEvent;
  const contextWindow = usageNumber(usage.contextWindow) ?? resolveCachedContextWindow(modelCaches, provider, model);
  if (contextWindow === undefined) return { ...usageEvent, usage };
  const contextPercent = contextPercentForUsage(usage, contextWindow);
  return {
    ...usageEvent,
    usage: {
      ...usage,
      contextWindow,
      ...(contextPercent !== undefined ? { contextPercent } : {})
    }
  };
}

function usageEventsFromEvent(event) {
  if (event?.type === "agent.usage" && normalizeUsage(event.usage)) return [event];
  if (event?.type !== "agent.transcript" || event.providerEventType !== "agent_end") return [];
  const messages = Array.isArray(event.providerEvent?.messages) ? event.providerEvent.messages : [];
  return messages.flatMap((message) => {
    const usage = normalizeUsage(message?.usage);
    if (!usage) return [];
    return [{
      ts: event.ts,
      taskId: event.taskId,
      runId: event.runId,
      actor: event.actor,
      agentId: event.agentId || event.actor,
      role: event.role || event.actor,
      responseId: message.responseId,
      provider: usageText(message?.provider ?? event.provider ?? event.providerEvent?.provider),
      model: usageText(message?.model ?? event.model ?? event.providerEvent?.model),
      usage
    }];
  });
}

export function aggregateTaskUsage(events = [], { modelCaches = [] } = {}) {
  const byAgent = new Map();
  const total = {};
  const seen = new Set();
  const runModels = runModelEvents(events);
  for (const run of runDurations(events)) {
    const current = byAgent.get(run.agentId) || { agentId: run.agentId, role: run.role, runs: 0 };
    addUsageMetric(current, "durationMs", run.end - run.start);
    addUsageMetric(total, "durationMs", run.end - run.start);
    byAgent.set(run.agentId, current);
  }
  for (const event of events) {
    for (const usageEvent of usageEventsFromEvent(event)) {
      const agentId = usageEvent.agentId || usageEvent.agent || usageEvent.actor || "agent";
      const key = [usageEvent.responseId || "", usageEvent.runId || "", usageEvent.ts || "", agentId].join("\u0001");
      if (seen.has(key)) continue;
      seen.add(key);
      const current = byAgent.get(agentId) || { agentId, role: usageEvent.role || usageEvent.actor, runs: 0 };
      const runModel = runModels.get(usageEvent.runId) || {};
      const provider = usageText(usageEvent.provider) || runModel.provider;
      const model = usageText(usageEvent.model) || runModel.model || "n/d";
      const usageWithContext = usageEventWithContext(usageEvent, modelCaches, provider, model);
      const modelUsage = usageModelTarget(current, provider, model);
      current.runs += 1;
      modelUsage.runs += 1;
      applyUsageEvent(current, usageWithContext);
      applyUsageEvent(modelUsage, usageWithContext);
      applyUsageEvent(total, usageWithContext);
      byAgent.set(agentId, current);
    }
  }
  const agents = [...byAgent.values()].map((agent) => {
    const models = [...(agent._models?.values() || [])].sort((a, b) => `${a.provider || ""}/${a.model}`.localeCompare(`${b.provider || ""}/${b.model}`));
    const { _models, ...rest } = agent;
    return models.length ? { ...rest, models } : rest;
  }).sort((a, b) => a.agentId.localeCompare(b.agentId));
  return agents.length ? { total, byAgent: agents } : null;
}

export async function readTaskUsage(taskId, rootInput) {
  const p = paths(rootInput);
  const openRouterCache = await readProviderModelsCache(rootInput, "openrouter");
  return aggregateTaskUsage(await readJsonl(join(p.tasks, taskId, "events.jsonl")), { modelCaches: [openRouterCache].filter(Boolean) });
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(out[key], value)
      : value;
  }
  return out;
}

async function listYamlValues(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const yamlValues = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml")).map((entry) => readYaml(join(dir, entry.name))));
    const skillDirs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readSkillMarkdown(join(dir, entry.name), entry.name)));
    return [...yamlValues, ...skillDirs].filter(Boolean);
  } catch {
    return [];
  }
}

export async function initStorage(rootInput) {
  const key = paths(rootInput).root;
  if (!storageInitCache.has(key)) {
    storageInitCache.set(key, (async () => {
      const p = paths(rootInput);
      logStep("fsdb", "initStorage.start", { root: p.root });
      const dirs = [
        p.settings,
        join(p.settings, "boards"),
        join(p.settings, "projects"),
        join(p.settings, "agents"),
        join(p.settings, "roles"),
        join(p.settings, "prompts"),
        join(p.settings, "provider-models"),
        join(p.settings, "hooks"),
        join(p.settings, "skills"),
        join(p.runtime, "sessions"),
        join(p.runtime, "locks"),
        join(p.runtime, "indexes"),
        join(p.runtime, "logs"),
        join(p.runtime, "tmp"),
        p.tasks
      ];
      await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
      await ensureYaml(join(p.settings, "app.yaml"), {
        schema: "kanban-code-agent/app@1",
        storageRoot: p.root,
        boardId: "default",
        runtimeRoot: join(p.settings, "runtime"),
        workspace: { name: "Kanban Code Agent", language: "pt-BR" },
        persistence: { taskStateFormat: "yaml", contextFormat: "markdown", eventsFormat: "jsonl", versionTaskData: true, versionRuntimeSessions: false },
        runtime: {
          maxParallelTasks: 1000,
          maxParallelAgents: 4,
          maxParallelMerges: 1,
          agentSessionRetentionDays: 30,
          resumeSessions: true,
          chatCompaction: { maxActiveMessages: 50 },
          projectTokens: { "kanban-code-agent": 2 }
        },
        workflow: DEFAULT_WORKFLOW_SETTINGS,
        ai: DEFAULT_AI_SETTINGS,
        manualMove: { confirmWhenRunning: true, defaultInterruptPolicy: "ask" },
        ui: { theme: "system", density: "comfortable", showProgressOnCard: true, showAgentOnCard: true, showProjectTargetsOnCard: true, showDependencyBadgesOnCard: true },
        safety: { requireApprovalForMerge: true, requireApprovalForDelete: true, allowShell: true, allowNetwork: false },
        tools: { builtin: ["read", "write", "edit", "bash", "grep", "find", "ls"], custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"] }
      });
      await ensureAppDefaults(join(p.settings, "app.yaml"));
      await ensureYaml(join(p.settings, "boards", "default.yaml"), {
        schema: "kanban-code-agent/board@1",
        id: "default",
        columns: DEFAULT_COLUMNS.map(defaultColumnSettings)
      });
      await ensureDefaultBoardColumns(join(p.settings, "boards", "default.yaml"));
      await ensureYaml(join(p.settings, "hooks", "summarize-blocker.yaml"), {
        schema: "kanban-code-agent/hook@1",
        id: "summarize-blocker",
        label: "Resumir espera humana",
        kind: "agent-action",
        agent: "hook-agent",
        trigger: "onEnter",
        outputs: { writeSummaryTo: "summaries/blocker.md" },
        timeoutMs: 120000
      });
      await ensureYaml(join(p.settings, "hooks", "run-checks.yaml"), {
        schema: "kanban-code-agent/hook@1",
        id: "run-checks",
        label: "Registrar validação",
        kind: "noop",
        trigger: "onEnter",
        timeoutMs: 120000
      });
      const defaultAgents = [
        {
          id: "manager",
          label: "Manager",
          skills: ["kanban-management"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "wait_for_persona", "delegate_task", "spawn_subtasks", "review_subtask", "answer_subtask_question", "approve_task_spec", "record_handoff", "record_decision", "record_summary", "run_definition_of_ready_gate", "run_definition_of_done_gate"],
          maxParallelTasks: 50,
          prompt: "# Manager\n\nMission: choose exactly one simplest next operational action for the task.\n\nInputs: task metadata, workflow state, task-spec, acceptance, planning, recent task chat, artifacts, blockers, and tool results.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, wait_for_persona, delegate_task, spawn_subtasks, review_subtask, answer_subtask_question, approve_task_spec, record_handoff, record_decision, record_summary, run_definition_of_ready_gate, run_definition_of_done_gate.\n\nOwns: triage, routing, unblocking, contract review/spec approval, DoR/DoD gates, execution planning after product approval, subtask review/answers, final summary, and deciding the next responsible persona.\n\nDoes not own: product contract, UX spec, system architecture, implementation, QA, code review, or deployment.\n\nSuggestions: use product when product intent is missing; approve ready product specs with approve_task_spec; use architecture for complex technical planning; use design for UI/UX; use engineering for implementation; use quality/review/deployment for validation, review, and release evidence; use generalist for non-code operational work; create parallel subtasks when work is independent; approve or reject waiting_review subtasks and answer waiting_response subtasks.\n\nEvidence: cite the task fact or blocker that justifies the action.\n\nHandoff: include target persona, concrete request, expected output, and stop after the handoff.\n\nRequired output: exactly one visible decision, one tool call, or an execution-plan artifact when planning is needed.\n\nStop conditions: after one visible decision or one tool call, stop. Never repeat the same blocker, delegation, or comment. If required live/current external data is genuinely unavailable after concrete command evidence, use report_blocker or request_user_input instead of continuing with estimates. Text alone does not finish the run; use a terminal tool.\n\nForbidden actions: do not implement code, define acceptance, validate behavior, review code, deploy, or move directly to Done.\n"
        },
        {
          id: "product",
          label: "Product",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "emit_artifact", "spawn_subtasks", "create_task_spec", "update_task_spec", "approve_task_spec", "record_decision", "record_handoff"],
          maxParallelTasks: 50,
          prompt: "# Product\n\nMission: turn the request into clear product intent and acceptance criteria.\n\nInputs: user request, task description, recent chat, existing acceptance, planning, and artifacts.\n\nAllowed tools: complete_task, request_user_input, emit_artifact, spawn_subtasks.\n\nOwns: problem, value, scope, acceptance criteria, data freshness/source requirements, and product risks.\n\nDoes not own: implementation, QA execution, code review, deployment, or technical architecture beyond product constraints.\n\nDecision ladder: clarify only blocking ambiguity; replace placeholder acceptance with verifiable criteria by calling emit_artifact with path \"acceptance.md\" before handoff; define expected artifact/output; route UI to design, complex technical planning to architecture, direct operational work to generalist, or accepted build work to engineering.\n\nEvidence: acceptance criteria must be verifiable by a human or automated check and persisted in acceptance.md.\n\nHandoff: name the next persona and the exact product contract they should satisfy.\n\nRequired output: explicit acceptance criteria persisted to acceptance.md and next responsible persona.\n\nStop conditions: complete after the product contract is explicit enough for the next role and acceptance.md is no longer placeholder.\n\nForbidden actions: do not implement, validate, review, deploy, or invent external constraints without marking them as assumptions.\n"
        },
        {
          id: "design",
          label: "Design",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "emit_artifact"],
          maxParallelTasks: 50,
          prompt: "# Design\n\nMission: define UX flow, states, accessibility, and visual handoff when design work is relevant.\n\nInputs: product contract, task description, acceptance, recent chat, and existing artifacts.\n\nAllowed tools: complete_task, request_user_input, emit_artifact.\n\nOwns: UX behavior, screen states, accessibility expectations, visual constraints, and design handoff.\n\nDoes not own: product scope, implementation, QA execution, code review, or deployment.\n\nDecision ladder: mark design not applicable when no UI/UX is affected; otherwise define flow, states, accessibility, and visual constraints; hand off to architecture for complex technical UX implications or engineering for straightforward implementation.\n\nEvidence: artifact or summary must state the affected screens/states and accessibility expectations.\n\nHandoff: provide concise implementation guidance and validation expectations.\n\nRequired output: design constraints or a clear no-design-impact decision.\n\nStop conditions: complete once the next persona can proceed without guessing UX behavior.\n\nForbidden actions: do not implement code, deploy, or review merge readiness.\n"
        },
        {
          id: "architecture",
          label: "Architecture",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks", "record_technical_plan", "record_implementation_tasks"],
          maxParallelTasks: 50,
          prompt: "# Architecture\n\nMission: define technical approach, internal contracts, risks, and implementation sequencing for complex development work.\n\nInputs: product contract, design handoff, task description, acceptance, planning, artifacts, dependencies, and worktree path.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, spawn_subtasks.\n\nOwns: architecture decisions, API/schema contracts, migration strategy, risk boundaries, file ownership, and subtask decomposition.\n\nDoes not own: product scope, UX choices, implementation, QA execution, code review, or deployment.\n\nDecision ladder: inspect product/design context; ask only for blocking technical decisions; emit a concise technical plan; spawn subtasks only when independent work can run in parallel; hand off accepted build work to engineering.\n\nEvidence: cite contracts, affected modules, risks, and validation expectations.\n\nHandoff: provide exact engineering request, expected files or surfaces, and validation gates.\n\nRequired output: implementation-ready technical plan or a blocker with the missing decision.\n\nStop conditions: complete after engineering can implement without architectural guessing.\n\nForbidden actions: do not implement code, validate behavior, review code, deploy, or redefine product acceptance.\n"
        },
        {
          id: "generalist",
          label: "Generalist",
          skills: ["kanban-management"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command", "record_handoff"],
          maxParallelTasks: 50,
          prompt: "# Generalist\n\nMission: execute non-code operational work with evidence or delegate technical work.\n\nInputs: task description, concrete acceptance/task-spec, recent chat, artifacts, and prior persona handoffs.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command, record_handoff.\n\nOwns: research, listing, summarization, formatting, documentation, and non-code artifacts.\n\nDoes not own: product acceptance definition, implementation, QA, code review, deployment, or DoD.\n\nDecision ladder: if acceptance is missing but the request is concrete direct research/listing, gather concise evidence with run_command when current/live data is needed, answer with source/date assumptions, and complete_task to request Manager DoD; if a command needs pipes, redirects, globbing, or multiple commands, use command \"sh\" with args [\"-lc\", \"...\"]; do not pass shell operators as curl/grep args; do not retry the same live source more than twice; if live data fails, cite the exact stdout/stderr and do not invent a sandbox/network blocker; if acceptance/spec is truly blocking, report blocker to manager/product; complete non-code research/docs/coordination with source evidence; ask human for missing required input; report blocker if blocked; delegate technical work to architecture or engineering.\n\nEvidence: cite the source, artifact, or result that proves completion.\n\nHandoff: include exact architecture or engineering request when technical work is needed.\n\nRequired output: completed answer or artifact plus source/evidence, or one blocker.\n\nStop conditions: request Manager DoD, block, or hand off once.\n\nForbidden actions: do not edit code, deploy, validate implementation, review merge readiness, or move directly to Done.\n"
        },
        {
          id: "engineering",
          label: "Engineering",
          skills: ["implementation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command", "record_validation", "record_implementation_tasks", "record_handoff"],
          maxParallelTasks: 50,
          prompt: "# Engineering\n\nMission: implement the accepted technical change in the task worktree and prove it works locally.\n\nInputs: product contract, architecture/design handoff when present, acceptance, planning, recent engineering chat, prior summaries, artifacts, dependencies, and worktree path.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command.\n\nOwns: code/config/test implementation and local developer validation.\n\nDoes not own: product acceptance, UX decisions, architecture for complex unresolved changes, QA signoff, code review, or deployment.\n\nDecision ladder: inspect task context; block if acceptance is placeholder; request architecture if technical design is missing for complex work; edit only needed files in the worktree; run targeted validation with run_command; complete to quality only after local validation passes.\n\nEvidence: include changed files and exact validation command/output summary.\n\nHandoff: report blockers with the missing prerequisite and next step; ask human only for required input unavailable from context.\n\nRequired output: implemented change, changed files, and local validation evidence.\n\nStop conditions: after completion or blocker, stop. Do not retry the same failing tool more than twice.\n\nForbidden actions: do not deploy, review code, spawn subtasks, use unrelated filesystem paths, or claim shell is unavailable before trying run_command.\n"
        },
        {
          id: "quality",
          label: "Quality",
          skills: ["validation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command", "review_task", "record_handoff"],
          maxParallelTasks: 50,
          prompt: "# Quality\n\nMission: validate that the delivered behavior satisfies acceptance criteria with concrete evidence.\n\nInputs: concrete acceptance/task-spec, implementation artifacts, recent chat, changed files, and validation outputs.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command, record_validation, record_handoff.\n\nOwns: functional QA, acceptance mapping, regression checks, browser/API/consumer validation, and pass/fail evidence.\n\nDoes not own: product scope, implementation fixes, code review, merge readiness, deployment, or DoD.\n\nDecision ladder: block to manager/product if acceptance/spec is missing or placeholder; map acceptance to checks; run or inspect validation evidence; call record_validation with acceptance-to-evidence mapping; pass code changes to review only when behavior satisfies acceptance.\n\nEvidence: every pass/fail must cite a command, artifact, screenshot, source, or observed output.\n\nHandoff: failures go to the responsible persona with exact reproduction and expected fix.\n\nRequired output: QA decision with acceptance-to-evidence mapping in validation-report.md.\n\nStop conditions: record validation or report one blocker; do not loop validation after a definitive failure.\n\nForbidden actions: do not implement fixes, deploy, decide code merge readiness, or move directly to Done.\n"
        },
        {
          id: "review",
          label: "Review",
          skills: ["review"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command", "record_review_report"],
          maxParallelTasks: 50,
          prompt: "# Review\n\nMission: perform code review and decide diff/merge readiness after QA evidence exists.\n\nInputs: diff/artifacts, changed files, validation evidence, recent chat, and task history.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command.\n\nOwns: code review, maintainability, security risks, regressions visible in the diff, and merge readiness.\n\nDoes not own: product acceptance definition, functional QA signoff, implementation fixes, deployment, or research/data verification.\n\nDecision ladder: block to quality if QA evidence is missing; inspect diff and evidence; run lightweight verification if needed; list blocking findings first; pass to deployment only when code is merge-ready.\n\nEvidence: findings need severity, reason, and file/artifact reference when available.\n\nHandoff: blockers go back to engineering with exact corrective action.\n\nRequired output: merge-ready decision or blocking code-review findings.\n\nStop conditions: finish after one review decision.\n\nForbidden actions: do not implement broad fixes, validate product acceptance, or deploy.\n"
        },
        {
          id: "deployment",
          label: "Deployment",
          skills: ["automation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "deploy_task", "record_deployment_report", "record_handoff"],
          maxParallelTasks: 50,
          prompt: "# Deployment\n\nMission: run release/deployment gates and record rollback evidence.\n\nInputs: review decision, validation evidence, deployment instructions, recent chat, and task artifacts.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact.\n\nOwns: release gate, deployment record, approval/secret checks, and rollback note.\n\nDoes not own: product scope, implementation, QA, code review, or bypassing prior gates.\n\nDecision ladder: verify approval/evidence; request credentials or approval if missing; record deployment/rollback notes; complete only when release criteria are satisfied.\n\nEvidence: deployment summary must include command/gate, result, and rollback note.\n\nHandoff: report deployment blockers with required human action or missing secret.\n\nRequired output: deployment summary or one deployment blocker.\n\nStop conditions: complete or block once; do not retry unsafe deploy commands blindly.\n\nForbidden actions: do not change implementation scope or bypass review.\n"
        },
        {
          id: "assistant",
          label: "Board Assistant",
          skills: ["kanban-management"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"],
          maxParallelTasks: 50,
          prompt: "# Board Assistant\n\nManage the Kanban board through typed tools. Create, update, move, explain, decompose, and route tasks without editing storage files directly.\n"
        },
        {
          id: "hook-agent",
          label: "Hook Agent",
          skills: ["automation"],
          tools: ["report_blocker", "emit_artifact"],
          maxParallelTasks: 50,
          prompt: "# Hook Agent\n\nRun short hook actions, summarize outcomes, and write concise evidence. Never make broad implementation changes from hooks.\n"
        }
      ];
      for (const agent of defaultAgents) {
        await ensureYaml(join(p.settings, "agents", `${agent.id}.yaml`), {
          schema: "kanban-code-agent/agent@1",
          id: agent.id,
          label: agent.label,
          provider: "inherit",
          model: { provider: "inherit", name: "", effort: "medium" },
          instructionsPath: `../prompts/${agent.id}.md`,
          skills: agent.skills,
          tools: agent.tools,
          limits: { maxParallelTasks: agent.maxParallelTasks }
        });
        await ensureAgentMaxParallelTasks(join(p.settings, "agents", `${agent.id}.yaml`), agent.maxParallelTasks);
        await ensureFile(join(p.settings, "prompts", `${agent.id}.md`), agent.prompt);
      }
      await ensureAgentTool(join(p.settings, "agents", "generalist.yaml"), "run_command");
      for (const agent of defaultAgents) {
        for (const tool of ["wait_for_persona", "delegate_task", "spawn_subtasks", "review_subtask", "answer_subtask_question"]) {
          await ensureAgentTool(join(p.settings, "agents", `${agent.id}.yaml`), tool);
        }
      }
      for (const role of DEFAULT_ROLES) {
        await ensureYaml(join(p.settings, "roles", `${role.id}.yaml`), {
          schema: "kanban-code-agent/role@1",
          ...role
        });
        await ensureFile(join(p.settings, "prompts", `${role.id}.md`), `# ${role.label}\n\n${role.gate}\n`);
      }
      await ensureYaml(join(p.runtime, "semaphores.yaml"), {
        schema: "kanban-code-agent/semaphores@1",
        tokens: {
          "global:tasks": 1000,
          "project:kanban-code-agent:tasks": 2,
          "project:kanban-code-agent:merge": 1,
          "agent:assistant": 50,
          "agent:hook-agent": 50,
          "agent:manager": 50,
          "agent:product": 50,
          "agent:design": 50,
          "agent:architecture": 50,
          "agent:generalist": 50,
          "agent:engineering": 50,
          "agent:quality": 50,
          "agent:review": 50,
          "agent:deployment": 50
        },
        leases: []
      });
      await ensureYaml(join(p.settings, "skills", "implementation.yaml"), {
        schema: "kanban-code-agent/skill@1",
        id: "implementation",
        instructionsPath: "implementation/SKILL.md"
      });
      await ensureFile(join(p.settings, "skills", "implementation", "SKILL.md"), [
        "---",
        "name: implementation",
        "description: Implement task changes inside the dedicated worktree and produce validation evidence.",
        "---",
        "",
        "# Implementation Skill",
        "",
        "## Rules",
        "",
        "- Work only in the task worktree when one is available.",
        "- Use typed Kanban tools to complete, block, request input, emit artifacts, or spawn subtasks.",
        "- Record concise validation evidence before completion.",
        ""
      ].join("\n"));
      await ensureFile(join(p.root, ".gitignore"), [
        "settings/runtime/sessions/",
        "settings/runtime/locks/",
        "settings/runtime/indexes/",
        "settings/runtime/logs/",
        "settings/runtime/tmp/",
        "**/.kca-cache/",
        "**/.env",
        "**/.env.*",
        "_worktrees/",
        "node_modules/",
        ""
      ].join("\n"));
      logStep("fsdb", "initStorage.ready", { root: p.root });
      return p;
    })().catch((error) => {
      storageInitCache.delete(key);
      throw error;
    }));
  }
  return storageInitCache.get(key);
}

export async function addProject(input, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "addProject.start", { id: input.id, repo: input.repo });
  const project = {
    schema: "kanban-code-agent/project@1",
    id: input.id,
    label: input.label || input.id,
    repoPath: input.repo,
    enabled: input.enabled ?? true
  };
  await writeYaml(join(p.settings, "projects", `${project.id}.yaml`), project);
  logStep("fsdb", "addProject.done", { id: project.id });
  return project;
}

export async function createTask(input, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "createTask.start", { title: input.title, column: input.column || "manager" });
  const id = input.id || `KCA-${String(Date.now()).slice(-6)}`;
  const taskDir = join(p.tasks, id);
  const now = new Date().toISOString();
  const requestedColumn = input.column || (input.draft ? "inbox" : "manager");
  const needsHumanIntake = !input.draft && normalizeColumnId(requestedColumn) === "manager" && !taskHasActionableIntent(input);
  const column = needsHumanIntake ? "human_wait" : await resolveStoredColumnId(requestedColumn, p);
  const title = needsHumanIntake ? UNCLEAR_TASK_TITLE : fallbackTaskTitle(input);
  const requestedWorktree = input.worktree || { enabled: true, kind: input.kind || "task", branch: input.branch || `kca/${id}`, pathRef: "worktree.yaml", parentTaskId: null, mergeTarget: "main" };
  const parentTaskId = input.parentTaskId ?? requestedWorktree.parentTaskId ?? null;
  const rootTaskId = input.rootTaskId ?? requestedWorktree.mainTaskId ?? (parentTaskId ? parentTaskId : id);
  const depth = Number.isInteger(input.depth) ? input.depth : parentTaskId ? 1 : 0;
  const worktree = { ...requestedWorktree, parentTaskId, mainTaskId: rootTaskId };
  const task = {
    schema: "kanban-code-agent/task@1",
    id,
    title,
    kind: input.kind || "task",
    column,
    status: needsHumanIntake ? "idle" : input.status || (input.draft ? "draft" : "idle"),
    priority: input.priority || "medium",
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    projectTargets: input.projectTargets || [],
    parentTaskId,
    rootTaskId,
    depth,
    routing: needsHumanIntake
      ? { currentAgent: null, currentRole: null, lastAgent: input.agent || "manager", lastRole: input.role || input.agent || "manager", manualOverride: { active: false } }
      : input.routing || { currentAgent: input.agent || "manager", currentRole: input.role || input.agent || "manager", manualOverride: { active: false } },
    worktree,
    dependencies: input.dependencies || { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    workflow: normalizeWorkflow({
      column: await resolveStoredColumnId(requestedColumn, p),
      status: needsHumanIntake ? "idle" : input.status || (input.draft ? "draft" : "idle"),
      routing: needsHumanIntake
        ? { currentAgent: null, currentRole: null }
        : input.routing || { currentAgent: input.agent || "manager", currentRole: input.role || input.agent || "manager" }
    }),
    hooks: input.hooks || { active: [] },
    skills: input.skills || { active: [] },
    tags: input.tags || []
  };
  await mkdir(taskDir, { recursive: true });
  await writeYaml(join(taskDir, "task.yaml"), task);
  await writeAtomic(join(taskDir, "description.md"), `# ${task.title}\n\n${input.description || ""}\n`);
  await writeAtomic(join(taskDir, "acceptance.md"), "# Critérios de aceite\n\n- [ ] Critério verificável de pronto.\n");
  await ensureWorkflowArtifacts(taskDir, task, input.description || "");
  await writeYaml(join(taskDir, "planning.yaml"), {
    schema: "kanban-code-agent/planning@1",
    taskId: id,
    status: "draft",
    createdByRole: "product",
    roles: {
      required: ["product", "design", "architecture", "engineering", "quality", "review", "deployment"],
      optional: ["manager"]
    },
    artifacts: {
      acceptance: "acceptance.md",
      design: "artifacts/design.md",
      technicalPlan: "plan.md"
    }
  });
  await writeYaml(join(taskDir, "dependencies.yaml"), { schema: "kanban-code-agent/dependencies@1", ...task.dependencies });
  await writeYaml(join(taskDir, "subtasks.yaml"), { schema: "kanban-code-agent/subtasks@2", taskId: id, parentTaskId: id, strategy: "dag", mergePolicy: "sequential-into-parent-feature", nodes: [], subtasks: [], edges: [] });
  await writeYaml(join(taskDir, "worktree.yaml"), { schema: "kanban-code-agent/worktree@1", taskId: id, branch: task.worktree.branch, parentTaskId, mainTaskId: rootTaskId });
  await appendJsonl(join(taskDir, "comments.jsonl"), { ts: now, type: "comment.system", actor: needsHumanIntake ? "manager" : "system", taskId: id, body: needsHumanIntake ? "Preciso de mais informações para criar a task: informe o objetivo e o que deve ser feito." : "Task criada." });
  await appendJsonl(join(taskDir, "events.jsonl"), { ts: now, type: "task.created", actor: "user", taskId: id, task });
  if (needsHumanIntake) await appendJsonl(join(taskDir, "events.jsonl"), { ts: now, type: "human.input_requested", actor: "manager", taskId: id, reason: "missing_actionable_task_intent" });
  logStep("fsdb", "createTask.done", { id, column: task.column, status: task.status });
  return task;
}

export async function listTasks(rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "listTasks.start", { root: p.root });
  const ids = await readdir(p.tasks);
  const tasks = await Promise.all(ids.map(async (id) => {
    const task = await readTaskWithRuntime(id, p);
    if (!task) return null;
    try {
      const description = (await readFile(join(p.tasks, id, "description.md"), "utf8")).replace(/^# .*\n\n?/, "").trim();
      return { ...task, description };
    } catch {
      return task;
    }
  }));
  const result = tasks.filter(Boolean);
  logStep("fsdb", "listTasks.done", { count: result.length });
  return result;
}

export async function getTask(taskId, rootInput) {
  const p = paths(rootInput);
  logStep("fsdb", "getTask", { taskId });
  return readTaskWithRuntime(taskId, p);
}

async function readTaskWithRuntime(taskId, p) {
  const task = await readYaml(join(p.tasks, taskId, "task.yaml"));
  if (!task) return null;
  const normalizedTreeTask = normalizeTaskTreeFields(task);
  const workflow = normalizeWorkflow(task);
  if (!task.workflow || WORKFLOW_GATE_KEYS.some((key) => !task.workflow?.gates?.[key]) || !task.workflow?.artifacts) {
    const taskPath = join(p.tasks, taskId, "task.yaml");
    await writeYaml(taskPath, { ...normalizedTreeTask, workflow });
    await ensureWorkflowArtifacts(join(p.tasks, taskId), { ...normalizedTreeTask, workflow });
  }
  normalizedTreeTask.workflow = workflow;
  const events = await readJsonl(join(p.tasks, taskId, "events.jsonl"));
  const failure = latestFailure(events);
  return failure ? { ...normalizedTreeTask, failure } : normalizedTreeTask;
}

function normalizeTaskTreeFields(task) {
  const parentTaskId = task.parentTaskId ?? task.worktree?.parentTaskId ?? null;
  const rootTaskId = task.rootTaskId ?? task.worktree?.mainTaskId ?? (parentTaskId ? parentTaskId : task.id);
  const depth = Number.isInteger(task.depth) ? task.depth : parentTaskId ? 1 : 0;
  const worktree = task.worktree ? { ...task.worktree, parentTaskId, mainTaskId: rootTaskId } : task.worktree;
  return { ...task, parentTaskId, rootTaskId, depth, ...(worktree ? { worktree } : {}) };
}

function latestFailure(events = []) {
  const failureTypes = ["agent.failed", "task.blocked", "task.run.blocked", "task.decompose.failed", "gate.failed", "merge.blocked"];
  const clearTypes = ["agent.queued", "agent.started", "task.unblocked", "gate.passed"];
  const failedIndex = events.findLastIndex((event) => failureTypes.includes(event.type));
  if (failedIndex < 0) return null;
  if (events.slice(failedIndex + 1).some((event) => clearTypes.includes(event.type))) return null;
  const failed = events[failedIndex];
  if (!failed) return null;
  const reason = failed.reason
    || failed.error
    || failed.message
    || failed.blocker
    || (failed.errors ? JSON.stringify(failed.errors) : "")
    || (failed.patch?.dependencies?.blockedBy ? failed.patch.dependencies.blockedBy.join(", ") : "")
    || (failed.patch?.status ? `status:${failed.patch.status}` : "")
    || failed.type;
  return {
    type: failed.type,
    reason: String(reason),
    ts: failed.ts,
    actor: failed.actor,
    runId: failed.runId
  };
}

export async function updateTask(taskId, patch, rootInput, eventType = "task.updated") {
  const p = paths(rootInput);
  logStep("fsdb", "updateTask.start", { taskId, eventType, patchKeys: Object.keys(patch || {}) });
  const taskPath = join(p.tasks, taskId, "task.yaml");
  const current = await readYaml(taskPath);
  if (!current) throw new Error(`Task not found: ${taskId}`);
  const updatedAt = new Date().toISOString();
  const normalizedPatch = patchWithWorkflow(current, patch);
  const task = { ...current, ...normalizedPatch, updatedAt };
  await writeYaml(taskPath, task);
  await ensureWorkflowArtifacts(dirname(taskPath), task);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: updatedAt, type: eventType, actor: "user", taskId, patch: normalizedPatch });
  logStep("fsdb", "updateTask.done", { taskId, column: task.column, status: task.status });
  return task;
}

export async function writeTaskFile(taskId, relativePath, content, rootInput) {
  const p = paths(rootInput);
  logStep("fsdb", "writeTaskFile", { taskId, relativePath });
  const file = join(p.tasks, taskId, relativePath);
  await writeAtomic(file, content);
  return relativePath;
}

export async function writeTaskAttachment(taskId, fileName, data, rootInput) {
  const p = paths(rootInput);
  const safeName = safeAttachmentName(fileName);
  const relativePath = `attachments/${Date.now()}-${safeName}`;
  logStep("fsdb", "writeTaskAttachment", { taskId, relativePath });
  await writeAtomic(join(p.tasks, taskId, relativePath), data);
  return relativePath;
}

const IMAGE_CONTENT_TYPES = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const TEXT_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".diff": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8"
};

function looksText(buffer) {
  if (!buffer.length) return true;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / buffer.length < 0.02;
}

async function readFileSample(path, bytes = 512) {
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function taskFileContentType(relativePath, kind = taskFileKind(relativePath)) {
  const ext = extname(relativePath).toLowerCase();
  if (IMAGE_CONTENT_TYPES[ext]) return IMAGE_CONTENT_TYPES[ext];
  if (TEXT_CONTENT_TYPES[ext]) return TEXT_CONTENT_TYPES[ext];
  return kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream";
}

export function taskFileKind(relativePath, sample) {
  const ext = extname(relativePath).toLowerCase();
  if (IMAGE_CONTENT_TYPES[ext]) return "image";
  if (TEXT_CONTENT_TYPES[ext]) return "text";
  if (sample) return looksText(sample) ? "text" : "binary";
  return "binary";
}

export function resolveTaskFilePath(taskId, relativePath, rootInput) {
  const p = paths(rootInput);
  const taskDir = resolve(p.tasks, taskId);
  const cleanPath = String(relativePath || "").replaceAll("\\", "/");
  if (!cleanPath || cleanPath.includes("\0") || cleanPath.startsWith("/")) throw new Error("invalid_task_file_path");
  const filePath = resolve(taskDir, cleanPath);
  if (filePath !== taskDir && !filePath.startsWith(`${taskDir}${sep}`)) throw new Error("task_file_path_outside_task");
  return { taskDir, filePath, relativePath: cleanPath };
}

export async function listTaskFileEntries(taskId, rootInput) {
  const filePaths = await listTaskFiles(taskId, rootInput);
  return Promise.all(filePaths.map(async (path) => {
    const { filePath } = resolveTaskFilePath(taskId, path, rootInput);
    const info = await stat(filePath);
    const sample = await readFileSample(filePath);
    const kind = taskFileKind(path, sample);
    return { path, size: info.size, kind, contentType: taskFileContentType(path, kind) };
  }));
}

export async function listTaskFiles(taskId, rootInput) {
  const p = paths(rootInput);
  const taskDir = join(p.tasks, taskId);
  async function walk(dir, prefix = "") {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const rows = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) rows.push(...await walk(join(dir, entry.name), relative));
      else rows.push(relative);
    }
    return rows;
  }
  return (await walk(taskDir)).sort();
}

export async function moveTask(taskId, toColumn, rootInput) {
  const p = paths(rootInput);
  logStep("fsdb", "moveTask.start", { taskId, toColumn });
  const taskPath = join(p.tasks, taskId, "task.yaml");
  const task = await readYaml(taskPath);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const from = task.column;
  task.column = await resolveStoredColumnId(toColumn, p);
  if (task.column === "done") {
    task.column = "manager";
    task.status = "queued";
    task.workflow = {
      ...normalizeWorkflow(task),
      phase: "review",
      currentRole: "manager",
      boardColumn: "manager",
      gates: {
        ...normalizeWorkflow(task).gates,
        definitionOfDone: { status: "pending", reason: "Direct Done move requested; waiting for DoD gate.", evidence: [`move:${from}->done`] }
      }
    };
  } else {
    task.workflow = normalizeWorkflow(task);
  }
  task.updatedAt = new Date().toISOString();
  await writeYaml(taskPath, task);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: task.updatedAt, type: "task.moved", actor: "user", taskId, from, to: task.column, patch: { column: task.column, status: task.status } });
  logStep("fsdb", "moveTask.done", { taskId, from, to: task.column });
  return task;
}

function appScopeKey(scope) {
  const map = {
    workspace: "workspace",
    interface: "ui",
    persistence: "persistence",
    concurrency: "runtime",
    sessions: "runtime",
    permissions: "safety",
    tools: "tools",
    workflow: "workflow"
  };
  return map[scope] || null;
}

async function readAgentWithPrompt(settingsDir, agent) {
  const normalized = normalizeAgentSettings(agent);
  if (!normalized?.instructionsPath) return normalized;
  try {
    return { ...normalized, instructionsBody: await readFile(join(settingsDir, "agents", normalized.instructionsPath), "utf8") };
  } catch {
    return normalized;
  }
}

function normalizeAgentSettings(agent) {
  if (!agent) return agent;
  const limits = {
    ...(agent.limits || {}),
    maxParallelTasks: agent.limits?.maxParallelTasks ?? agent.limits?.tokens ?? 50
  };
  const normalized = { ...agent, limits };
  if (agent.id !== "manager") return normalized;
  const required = ["wait_for_persona", "spawn_subtasks", "review_subtask", "answer_subtask_question", "approve_task_spec"];
  if (Array.isArray(normalized.tools)) return { ...normalized, tools: [...new Set([...normalized.tools, ...required])] };
  return { ...normalized, tools: { ...(normalized.tools || {}), custom: [...new Set([...(normalized.tools?.custom || []), ...required])] } };
}

export async function readSettingsScope(scope = "app", rootInput) {
  const p = await initStorage(rootInput);
  const normalized = scope || "app";
  logStep("fsdb", "readSettingsScope.start", { scope: normalized });
  const app = await readSettings(rootInput);
  if (normalized === "app") return app;
  const appKey = appScopeKey(normalized);
  if (appKey) return { scope: normalized, [appKey]: app[appKey] || {} };
  if (normalized === "board") return readYaml(join(p.settings, "boards", "default.yaml"), {});
  if (normalized === "columns") {
    const board = await readYaml(join(p.settings, "boards", "default.yaml"), {});
    return { scope: normalized, boardId: board.id || "default", columns: board.columns || [] };
  }
  if (normalized === "column-hooks" || normalized === "hooks") {
    const board = await readYaml(join(p.settings, "boards", "default.yaml"), {});
    return { scope: normalized, columns: board.columns || [], hooks: await listYamlValues(join(p.settings, "hooks")) };
  }
  if (normalized === "agents") {
    const agents = await listYamlValues(join(p.settings, "agents"));
    return { scope: normalized, agents: await Promise.all(agents.map((agent) => readAgentWithPrompt(p.settings, agent))) };
  }
  if (normalized === "roles") return { scope: normalized, roles: await listYamlValues(join(p.settings, "roles")) };
  if (normalized === "skills") return { scope: normalized, skills: await listYamlValues(join(p.settings, "skills")) };
  if (normalized === "semaphores") return readYaml(join(p.runtime, "semaphores.yaml"), { schema: "kanban-code-agent/semaphores@1", tokens: {}, leases: [] });
  if (normalized === "projects" || normalized === "repositories") return { scope: normalized, projects: await listYamlValues(join(p.settings, "projects")) };
  if (normalized === "worktrees") {
    return { scope: normalized, runtimeRoot: app.runtimeRoot, projects: (await listYamlValues(join(p.settings, "projects"))).map((project) => ({ id: project.id, worktrees: project.worktrees || {}, repoPath: project.repoPath })) };
  }
  const result = { scope: normalized, settings: app };
  logStep("fsdb", "readSettingsScope.done", { scope: normalized });
  return result;
}

async function updateYamlById(dir, id, patch, fallbackSchema, rootInput) {
  if (!id) throw new Error("settings scope update requires id");
  const p = await initStorage(rootInput);
  const file = join(p.settings, dir, `${id}.yaml`);
  const current = await readYaml(file, { schema: fallbackSchema, id });
  const updated = deepMerge(current, patch);
  await writeYaml(file, updated);
  await appendJsonl(join(p.runtime, "logs", "events.jsonl"), { ts: new Date().toISOString(), type: "settings.updated", actor: "user", scope: dir, id });
  return updated;
}

export async function updateSettings(scopeOrPatch, patchOrRoot, maybeRoot) {
  const hasExplicitScope = typeof scopeOrPatch === "string";
  const scope = hasExplicitScope ? scopeOrPatch : "app";
  const patch = hasExplicitScope ? patchOrRoot : scopeOrPatch;
  const rootInput = hasExplicitScope ? maybeRoot : patchOrRoot;
  const p = await initStorage(rootInput);
  const normalized = scope || "app";
  logStep("fsdb", "updateSettings.start", { scope: normalized });
  if (["agents", "skills", "hooks", "projects"].includes(normalized)) {
    const dir = normalized === "projects" ? "projects" : normalized;
    const schema = `kanban-code-agent/${normalized.slice(0, -1)}@1`;
    const { instructionsBody, ...yamlPatch } = patch;
    const updated = await updateYamlById(dir, yamlPatch.id, yamlPatch, schema, rootInput);
    if (normalized === "agents" && typeof instructionsBody === "string") {
      const instructionsPath = updated.instructionsPath || `../prompts/${updated.id}.md`;
      await writeAtomic(join(p.settings, "agents", instructionsPath), instructionsBody);
    }
    logStep("fsdb", "updateSettings.done", { scope: normalized, id: updated.id });
    return updated;
  }
  if (normalized === "board" || normalized === "columns" || normalized === "column-hooks") {
    const boardPath = join(p.settings, "boards", "default.yaml");
    const current = await readYaml(boardPath, { schema: "kanban-code-agent/board@1", id: "default", columns: [] });
    const boardPatch = normalized === "columns" ? { columns: patch.columns || patch } : patch;
    const board = deepMerge(current, boardPatch);
    await writeYaml(boardPath, board);
    await appendJsonl(join(p.runtime, "logs", "events.jsonl"), { ts: new Date().toISOString(), type: "settings.updated", actor: "user", scope: normalized });
    logStep("fsdb", "updateSettings.done", { scope: normalized });
    return board;
  }
  const appPath = join(p.settings, "app.yaml");
  const current = await readYaml(appPath, {});
  const appKey = appScopeKey(normalized);
  const settings = appKey ? deepMerge(current, { [appKey]: patch[appKey] || patch }) : deepMerge(current, patch);
  await writeYaml(appPath, settings);
  await appendJsonl(join(p.runtime, "logs", "events.jsonl"), { ts: new Date().toISOString(), type: "settings.updated", actor: "user", scope: normalized });
  logStep("fsdb", "updateSettings.done", { scope: normalized });
  return appKey ? { scope: normalized, [appKey]: settings[appKey] } : settings;
}

export async function readSettings(rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "readSettings", { root: p.root });
  return readYaml(join(p.settings, "app.yaml"), {});
}

export async function readHook(hookId, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "readHook", { hookId });
  return readYaml(join(p.settings, "hooks", `${hookId}.yaml`), null);
}

export async function readAgent(agentId, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "readAgent", { agentId });
  return normalizeAgentSettings(await readYaml(join(p.settings, "agents", `${agentId}.yaml`), null));
}

export async function readSkill(skillId, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "readSkill", { skillId });
  return (await readSkillMarkdown(join(p.settings, "skills", skillId), skillId)) || readYaml(join(p.settings, "skills", `${skillId}.yaml`), null);
}

export async function readProject(projectId, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "readProject", { projectId });
  return readYaml(join(p.settings, "projects", `${projectId}.yaml`), null);
}

export async function rebuildTaskFromEvents(taskId, rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "rebuildTaskFromEvents.start", { taskId });
  const task = await getTask(taskId, rootInput);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const events = await readJsonl(join(p.tasks, taskId, "events.jsonl"));
  const created = events.find((event) => event.type === "task.created" && event.task)?.task;
  const rebuilt = events.reduce((state, event) => {
    if (event.patch && typeof event.patch === "object") return { ...state, ...event.patch, updatedAt: event.ts };
    if (event.type === "task.moved") return { ...state, column: event.to, updatedAt: event.ts };
    if (event.type === "task.blocked") return { ...state, column: "blocked", status: "blocked", updatedAt: event.ts };
    if (event.type === "agent.completed") return { ...state, status: "done", updatedAt: event.ts };
    if (event.type === "agent.interrupted") return { ...state, status: "interrupting", updatedAt: event.ts };
    if (event.type === "subtask.merged") return { ...state, status: "done", column: "done", updatedAt: event.ts };
    return state;
  }, created || task);
  await writeYaml(join(p.tasks, taskId, "task.yaml"), rebuilt);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: new Date().toISOString(), type: "task.recovered", actor: "daemon", taskId });
  logStep("fsdb", "rebuildTaskFromEvents.done", { taskId });
  return rebuilt;
}

export async function rebuildIndexes(rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "rebuildIndexes.start", { root: p.root });
  const tasks = (await listTasks(rootInput)).filter((task) => task.status !== "draft");
  await writeAtomic(join(p.runtime, "indexes", "tasks.json"), JSON.stringify(tasks.map(({ id, title, column, status }) => ({ id, title, column, status })), null, 2));
  logStep("fsdb", "rebuildIndexes.done", { taskCount: tasks.length });
  return { taskCount: tasks.length, indexPath: join(p.runtime, "indexes", "tasks.json") };
}

export async function boardSnapshot(rootInput) {
  const p = await initStorage(rootInput);
  logStep("fsdb", "boardSnapshot.start", { root: p.root });
  const board = await readYaml(join(p.settings, "boards", "default.yaml"), { columns: [] });
  const storedTasks = (await listTasks(rootInput)).filter((task) => task.status !== "draft");
  const directChildrenByParent = new Map();
  for (const task of storedTasks) {
    const parentTaskId = task.parentTaskId || task.worktree?.parentTaskId;
    if (!parentTaskId) continue;
    const children = directChildrenByParent.get(parentTaskId) || [];
    children.push(task);
    directChildrenByParent.set(parentTaskId, children);
  }
  const tasks = await Promise.all(storedTasks.map(async (task) => {
    const usage = await readTaskUsage(task.id, rootInput);
    const children = directChildrenByParent.get(task.id) || [];
    const subtasksSummary = children.length ? {
      total: children.length,
      running: children.filter((child) => ["queued", "running", "waiting", "validating"].includes(child.status)).length,
      done: children.filter((child) => child.status === "done").length,
      waitingReview: children.filter((child) => child.status === "waiting_review").length,
      waitingResponse: children.filter((child) => child.status === "waiting_response").length,
      paused: children.filter((child) => child.status === "paused").length,
      canceled: children.filter((child) => child.status === "canceled").length
    } : undefined;
    return { ...task, ...(usage ? { usage } : {}), ...(subtasksSummary ? { subtasksSummary } : {}) };
  }));
  const settings = await readSettings(rootInput);
  const result = {
    schema: "kanban-code-agent/state@1",
    columns: board.columns || [],
    tasks,
    settings,
    events: await readJsonl(join(p.runtime, "logs", "events.jsonl"))
  };
  logStep("fsdb", "boardSnapshot.done", { tasks: tasks.length, columns: result.columns.length });
  return result;
}

export async function recordCommandResult(commandId, result, rootInput) {
  if (!commandId) return result;
  const p = await initStorage(rootInput);
  logStep("fsdb", "recordCommandResult", { commandId });
  const file = join(p.runtime, "indexes", "commands", `${commandId}.json`);
  await writeAtomic(file, JSON.stringify(result, null, 2));
  return result;
}

export async function readCommandResult(commandId, rootInput) {
  if (!commandId) return null;
  const p = await initStorage(rootInput);
  logStep("fsdb", "readCommandResult", { commandId });
  try {
    return JSON.parse(await readFile(join(p.runtime, "indexes", "commands", `${commandId}.json`), "utf8"));
  } catch {
    return null;
  }
}
