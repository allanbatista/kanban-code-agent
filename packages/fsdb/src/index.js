import { constants } from "node:fs";
import { access, appendFile, mkdir, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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

export function normalizeColumnId(columnId) {
  return COLUMN_ALIASES[columnId] || columnId;
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
          maxParallelTasks: 3,
          maxParallelAgents: 4,
          maxParallelMerges: 1,
          agentSessionRetentionDays: 30,
          resumeSessions: true,
          chatCompaction: { maxActiveMessages: 50 },
          agentTokens: { assistant: 1, "hook-agent": 1, manager: 1, product: 1, design: 1, architecture: 1, generalist: 1, engineering: 2, quality: 1, review: 1, deployment: 1 },
          projectTokens: { "kanban-code-agent": 2 }
        },
        manualMove: { confirmWhenRunning: true, defaultInterruptPolicy: "ask" },
        ui: { theme: "system", density: "comfortable", showProgressOnCard: true, showAgentOnCard: true, showProjectTargetsOnCard: true, showDependencyBadgesOnCard: true },
        safety: { requireApprovalForMerge: true, requireApprovalForDelete: true, allowShell: true, allowNetwork: false },
        tools: { builtin: ["read", "write", "edit", "bash", "grep", "find", "ls"], custom: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"] }
      });
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
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "wait_for_persona", "delegate_task", "spawn_subtasks"],
          tokens: 1,
          prompt: "# Manager\n\nMission: choose exactly one simplest next operational action for the task.\n\nInputs: task metadata, acceptance, planning, recent task chat, artifacts, blockers, tool results, and Manager Routing Context.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, wait_for_persona, delegate_task, spawn_subtasks.\n\nOwns: triage, routing, unblocking, contract review, execution planning after product approval, and deciding the next responsible persona.\n\nDoes not own: product contract, UX spec, system architecture, implementation, QA, code review, or deployment.\n\nModes: intake routes unclear work to product or human; contract_review checks the product contract against the original user request; execution_planning defines phases, inputs, persona owners, dependencies, checkpoints, and may emit artifacts/execution-plan.md before subtasks; progress_control consumes outputs/blockers and picks the next incremental action.\n\nDecision ladder: if acceptance is missing or placeholder, use intake and route to product; if a product contract exists, use contract_review before execution; direct research/listing/docs with concrete acceptance uses execution_planning for generalist -> quality -> done; UI/UX goes to design; complex API/schema/migration/system planning goes to architecture before engineering; accepted code/config/API/tests go to engineering; functional validation, review, and deployment results use progress_control to pick the next action.\n\nEvidence: cite the task fact or blocker that justifies the action.\n\nHandoff: include target persona, concrete request, expected output, and stop after the handoff.\n\nRequired output: exactly one visible decision, one tool call, or an execution-plan artifact when planning is needed.\n\nStop conditions: after one visible decision or one tool call, stop. Never repeat the same blocker, delegation, or comment. Text alone does not finish the run; use a terminal tool.\n\nForbidden actions: do not implement code, define acceptance, validate behavior, review code, deploy, or create files unless the task explicitly needs a manager artifact.\n"
        },
        {
          id: "product",
          label: "Product",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "emit_artifact", "spawn_subtasks"],
          tokens: 1,
          prompt: "# Product\n\nMission: turn the request into clear product intent and acceptance criteria.\n\nInputs: user request, task description, recent chat, existing acceptance, planning, and artifacts.\n\nAllowed tools: complete_task, request_user_input, emit_artifact, spawn_subtasks.\n\nOwns: problem, value, scope, acceptance criteria, data freshness/source requirements, and product risks.\n\nDoes not own: implementation, QA execution, code review, deployment, or technical architecture beyond product constraints.\n\nDecision ladder: clarify only blocking ambiguity; replace placeholder acceptance with verifiable criteria; define expected artifact/output; route UI to design, complex technical planning to architecture, direct operational work to generalist, or accepted build work to engineering.\n\nEvidence: acceptance criteria must be verifiable by a human or automated check.\n\nHandoff: name the next persona and the exact product contract they should satisfy.\n\nRequired output: explicit acceptance criteria and next responsible persona.\n\nStop conditions: complete after the product contract is explicit enough for the next role.\n\nForbidden actions: do not implement, validate, review, deploy, or invent external constraints without marking them as assumptions.\n"
        },
        {
          id: "design",
          label: "Design",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "emit_artifact"],
          tokens: 1,
          prompt: "# Design\n\nMission: define UX flow, states, accessibility, and visual handoff when design work is relevant.\n\nInputs: product contract, task description, acceptance, recent chat, and existing artifacts.\n\nAllowed tools: complete_task, request_user_input, emit_artifact.\n\nOwns: UX behavior, screen states, accessibility expectations, visual constraints, and design handoff.\n\nDoes not own: product scope, implementation, QA execution, code review, or deployment.\n\nDecision ladder: mark design not applicable when no UI/UX is affected; otherwise define flow, states, accessibility, and visual constraints; hand off to architecture for complex technical UX implications or engineering for straightforward implementation.\n\nEvidence: artifact or summary must state the affected screens/states and accessibility expectations.\n\nHandoff: provide concise implementation guidance and validation expectations.\n\nRequired output: design constraints or a clear no-design-impact decision.\n\nStop conditions: complete once the next persona can proceed without guessing UX behavior.\n\nForbidden actions: do not implement code, deploy, or review merge readiness.\n"
        },
        {
          id: "architecture",
          label: "Architecture",
          skills: ["planning"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"],
          tokens: 1,
          prompt: "# Architecture\n\nMission: define technical approach, internal contracts, risks, and implementation sequencing for complex development work.\n\nInputs: product contract, design handoff, task description, acceptance, planning, artifacts, dependencies, and worktree path.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, spawn_subtasks.\n\nOwns: architecture decisions, API/schema contracts, migration strategy, risk boundaries, file ownership, and subtask decomposition.\n\nDoes not own: product scope, UX choices, implementation, QA execution, code review, or deployment.\n\nDecision ladder: inspect product/design context; ask only for blocking technical decisions; emit a concise technical plan; spawn subtasks only when independent work can run in parallel; hand off accepted build work to engineering.\n\nEvidence: cite contracts, affected modules, risks, and validation expectations.\n\nHandoff: provide exact engineering request, expected files or surfaces, and validation gates.\n\nRequired output: implementation-ready technical plan or a blocker with the missing decision.\n\nStop conditions: complete after engineering can implement without architectural guessing.\n\nForbidden actions: do not implement code, validate behavior, review code, deploy, or redefine product acceptance.\n"
        },
        {
          id: "generalist",
          label: "Generalist",
          skills: ["kanban-management"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"],
          tokens: 1,
          prompt: "# Generalist\n\nMission: execute non-code operational work with evidence or delegate technical work.\n\nInputs: task description, concrete acceptance, recent chat, artifacts, and prior persona handoffs.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact.\n\nOwns: research, listing, summarization, formatting, documentation, and non-code artifacts.\n\nDoes not own: product acceptance definition, implementation, QA, code review, or deployment.\n\nDecision ladder: if acceptance is missing, report blocker to manager/product; complete non-code research/docs/coordination with source evidence; ask human for missing required input; report blocker if blocked; delegate technical work to architecture or engineering.\n\nEvidence: cite the source, artifact, or result that proves completion.\n\nHandoff: include exact architecture or engineering request when technical work is needed.\n\nRequired output: completed artifact plus source/evidence, or one blocker.\n\nStop conditions: complete, block, or hand off once.\n\nForbidden actions: do not edit code, deploy, validate implementation, or review merge readiness.\n"
        },
        {
          id: "engineering",
          label: "Engineering",
          skills: ["implementation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command"],
          tokens: 2,
          prompt: "# Engineering\n\nMission: implement the accepted technical change in the task worktree and prove it works locally.\n\nInputs: product contract, architecture/design handoff when present, acceptance, planning, recent engineering chat, prior summaries, artifacts, dependencies, and worktree path.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command.\n\nOwns: code/config/test implementation and local developer validation.\n\nDoes not own: product acceptance, UX decisions, architecture for complex unresolved changes, QA signoff, code review, or deployment.\n\nDecision ladder: inspect task context; block if acceptance is placeholder; request architecture if technical design is missing for complex work; edit only needed files in the worktree; run targeted validation with run_command; complete to quality only after local validation passes.\n\nEvidence: include changed files and exact validation command/output summary.\n\nHandoff: report blockers with the missing prerequisite and next step; ask human only for required input unavailable from context.\n\nRequired output: implemented change, changed files, and local validation evidence.\n\nStop conditions: after completion or blocker, stop. Do not retry the same failing tool more than twice.\n\nForbidden actions: do not deploy, review code, spawn subtasks, use unrelated filesystem paths, or claim shell is unavailable before trying run_command.\n"
        },
        {
          id: "quality",
          label: "Quality",
          skills: ["validation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command"],
          tokens: 1,
          prompt: "# Quality\n\nMission: validate that the delivered behavior satisfies acceptance criteria with concrete evidence.\n\nInputs: concrete acceptance, implementation artifacts, recent chat, changed files, and validation outputs.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command.\n\nOwns: functional QA, acceptance mapping, regression checks, browser/API/consumer validation, and pass/fail evidence.\n\nDoes not own: product scope, implementation fixes, code review, merge readiness, or deployment.\n\nDecision ladder: block to manager/product if acceptance is missing or placeholder; map acceptance to checks; run or inspect validation evidence; emit audit artifact if useful; pass code changes to review only when behavior satisfies acceptance; complete non-code tasks to done when acceptance is satisfied.\n\nEvidence: every pass/fail must cite a command, artifact, screenshot, source, or observed output.\n\nHandoff: failures go to the responsible persona with exact reproduction and expected fix.\n\nRequired output: QA decision with acceptance-to-evidence mapping.\n\nStop conditions: complete or report one blocker; do not loop validation after a definitive failure.\n\nForbidden actions: do not implement fixes, deploy, or decide code merge readiness.\n"
        },
        {
          id: "review",
          label: "Review",
          skills: ["review"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "run_command"],
          tokens: 1,
          prompt: "# Review\n\nMission: perform code review and decide diff/merge readiness after QA evidence exists.\n\nInputs: diff/artifacts, changed files, validation evidence, recent chat, and task history.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact, run_command.\n\nOwns: code review, maintainability, security risks, regressions visible in the diff, and merge readiness.\n\nDoes not own: product acceptance definition, functional QA signoff, implementation fixes, deployment, or research/data verification.\n\nDecision ladder: block to quality if QA evidence is missing; inspect diff and evidence; run lightweight verification if needed; list blocking findings first; pass to deployment only when code is merge-ready.\n\nEvidence: findings need severity, reason, and file/artifact reference when available.\n\nHandoff: blockers go back to engineering with exact corrective action.\n\nRequired output: merge-ready decision or blocking code-review findings.\n\nStop conditions: finish after one review decision.\n\nForbidden actions: do not implement broad fixes, validate product acceptance, or deploy.\n"
        },
        {
          id: "deployment",
          label: "Deployment",
          skills: ["automation"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"],
          tokens: 1,
          prompt: "# Deployment\n\nMission: run release/deployment gates and record rollback evidence.\n\nInputs: review decision, validation evidence, deployment instructions, recent chat, and task artifacts.\n\nAllowed tools: complete_task, request_user_input, report_blocker, emit_artifact.\n\nOwns: release gate, deployment record, approval/secret checks, and rollback note.\n\nDoes not own: product scope, implementation, QA, code review, or bypassing prior gates.\n\nDecision ladder: verify approval/evidence; request credentials or approval if missing; record deployment/rollback notes; complete only when release criteria are satisfied.\n\nEvidence: deployment summary must include command/gate, result, and rollback note.\n\nHandoff: report deployment blockers with required human action or missing secret.\n\nRequired output: deployment summary or one deployment blocker.\n\nStop conditions: complete or block once; do not retry unsafe deploy commands blindly.\n\nForbidden actions: do not change implementation scope or bypass review.\n"
        },
        {
          id: "assistant",
          label: "Board Assistant",
          skills: ["kanban-management"],
          tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"],
          tokens: 1,
          prompt: "# Board Assistant\n\nManage the Kanban board through typed tools. Create, update, move, explain, decompose, and route tasks without editing storage files directly.\n"
        },
        {
          id: "hook-agent",
          label: "Hook Agent",
          skills: ["automation"],
          tools: ["report_blocker", "emit_artifact"],
          tokens: 1,
          prompt: "# Hook Agent\n\nRun short hook actions, summarize outcomes, and write concise evidence. Never make broad implementation changes from hooks.\n"
        }
      ];
      for (const agent of defaultAgents) {
        await ensureYaml(join(p.settings, "agents", `${agent.id}.yaml`), {
          schema: "kanban-code-agent/agent@1",
          id: agent.id,
          label: agent.label,
          provider: "pi",
          model: { provider: "pi", name: "default", effort: "medium" },
          instructionsPath: `../prompts/${agent.id}.md`,
          skills: agent.skills,
          tools: agent.tools,
          limits: { tokens: agent.tokens }
        });
        await ensureFile(join(p.settings, "prompts", `${agent.id}.md`), agent.prompt);
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
          "global:tasks": 4,
          "project:kanban-code-agent:tasks": 2,
          "project:kanban-code-agent:merge": 1,
          "agent:manager": 1,
          "agent:product": 1,
          "agent:design": 1,
          "agent:architecture": 1,
          "agent:generalist": 1,
          "agent:engineering": 2,
          "agent:quality": 1,
          "agent:review": 1,
          "agent:deployment": 1
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
    routing: needsHumanIntake
      ? { currentAgent: null, currentRole: null, lastAgent: input.agent || "manager", lastRole: input.role || input.agent || "manager", manualOverride: { active: false } }
      : input.routing || { currentAgent: input.agent || "manager", currentRole: input.role || input.agent || "manager", manualOverride: { active: false } },
    worktree: input.worktree || { enabled: true, kind: input.kind || "task", branch: input.branch || `kca/${id}`, pathRef: "worktree.yaml", parentTaskId: null, mergeTarget: "main" },
    dependencies: input.dependencies || { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    hooks: input.hooks || { active: [] },
    skills: input.skills || { active: [] },
    tags: input.tags || []
  };
  await mkdir(taskDir, { recursive: true });
  await writeYaml(join(taskDir, "task.yaml"), task);
  await writeAtomic(join(taskDir, "description.md"), `# ${task.title}\n\n${input.description || ""}\n`);
  await writeAtomic(join(taskDir, "acceptance.md"), "# Critérios de aceite\n\n- [ ] Critério verificável de pronto.\n");
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
  await writeYaml(join(taskDir, "worktree.yaml"), { schema: "kanban-code-agent/worktree@1", taskId: id, branch: task.worktree.branch });
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
  const events = await readJsonl(join(p.tasks, taskId, "events.jsonl"));
  const failure = latestFailure(events);
  return failure ? { ...task, failure } : task;
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
  const task = { ...current, ...patch, updatedAt };
  await writeYaml(taskPath, task);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: updatedAt, type: eventType, actor: "user", taskId, patch });
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
  task.status = task.column === "done" ? "done" : task.status;
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
    tools: "tools"
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
  if (!agent || agent.id !== "manager") return agent;
  const required = ["wait_for_persona", "delegate_task", "spawn_subtasks"];
  if (Array.isArray(agent.tools)) return { ...agent, tools: [...new Set([...agent.tools, ...required])] };
  return { ...agent, tools: { ...(agent.tools || {}), custom: [...new Set([...(agent.tools?.custom || []), ...required])] } };
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
  const tasks = (await listTasks(rootInput)).filter((task) => task.status !== "draft");
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
