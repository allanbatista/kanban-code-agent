import { constants } from "node:fs";
import { access, appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_ROLES } from "@kca/core/roles";
import YAML from "yaml";

export const DEFAULT_COLUMNS = ["inbox", "definition", "build", "validate", "blocked", "done"];

const DEFAULT_COLUMN_META = {
  inbox: { label: "Entrada", agent: "assistant", autoStart: false, wip: null },
  definition: { label: "Definição", agent: "architect", autoStart: true, wip: null },
  build: { label: "Construção", agent: "engineer", autoStart: true, wip: 4 },
  validate: { label: "Validação", agent: "validator", autoStart: true, wip: 2 },
  blocked: { label: "Bloqueado", agent: null, autoStart: false, wip: null },
  done: { label: "Encerrado", agent: null, autoStart: false, wip: null }
};

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
  const p = paths(rootInput);
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
      agentTokens: { assistant: 1, architect: 1, engineer: 2, validator: 1, reviewer: 1, manager: 1, product: 1, design: 1, engineering: 2, quality: 1, deployment: 1 },
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
    columns: DEFAULT_COLUMNS.map((id) => {
      const meta = DEFAULT_COLUMN_META[id];
      return { id, label: meta.label, agent: meta.agent, autoStart: meta.autoStart, wip: meta.wip, wipLimit: meta.wip, hooks: { onEnter: id === "blocked" ? ["summarize-blocker"] : id === "validate" ? ["run-checks"] : [], beforeLeave: [], onAgentComplete: [] } };
    })
  });
  await ensureYaml(join(p.settings, "hooks", "summarize-blocker.yaml"), {
    schema: "kanban-code-agent/hook@1",
    id: "summarize-blocker",
    label: "Resumir bloqueio",
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
      id: "assistant",
      label: "Board Assistant",
      skills: ["kanban-management"],
      tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"],
      tokens: 1,
      prompt: "# Board Assistant\n\nManage the Kanban board through typed tools. Create, update, move, explain, decompose, and route tasks without editing storage files directly.\n"
    },
    {
      id: "architect",
      label: "Architect",
      skills: ["planning"],
      tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact", "spawn_subtasks"],
      tokens: 1,
      prompt: "# Architect\n\nRefine scope, acceptance criteria, risks, dependencies, file locks, and subtask plans. Produce executable plans with validation evidence.\n"
    },
    {
      id: "engineer",
      label: "Engineer",
      skills: ["implementation"],
      tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"],
      tokens: 2,
      prompt: "# Engineer\n\nImplement the task inside the dedicated worktree when available. Keep changes scoped, run validation, emit artifacts when useful, and complete via typed tool only.\n"
    },
    {
      id: "validator",
      label: "Validator",
      skills: ["validation"],
      tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"],
      tokens: 1,
      prompt: "# Validator\n\nValidate behavior against acceptance criteria with concrete evidence. Report blockers for failures and complete only when evidence proves the task is ready.\n"
    },
    {
      id: "reviewer",
      label: "Reviewer",
      skills: ["review"],
      tools: ["complete_task", "request_user_input", "report_blocker", "emit_artifact"],
      tokens: 1,
      prompt: "# Reviewer\n\nReview risks, regressions, missing tests, and merge readiness. Prioritize actionable findings with file and evidence references.\n"
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
  return p;
}

export async function addProject(input, rootInput) {
  const p = await initStorage(rootInput);
  const project = {
    schema: "kanban-code-agent/project@1",
    id: input.id,
    label: input.label || input.id,
    repoPath: input.repo,
    enabled: input.enabled ?? true
  };
  await writeYaml(join(p.settings, "projects", `${project.id}.yaml`), project);
  return project;
}

export async function createTask(input, rootInput) {
  const p = await initStorage(rootInput);
  const id = input.id || `KCA-${String(Date.now()).slice(-6)}`;
  const taskDir = join(p.tasks, id);
  const now = new Date().toISOString();
  const task = {
    schema: "kanban-code-agent/task@1",
    id,
    title: input.title,
    kind: input.kind || "task",
    column: input.column || "inbox",
    status: input.status || "idle",
    priority: input.priority || "medium",
    createdAt: now,
    updatedAt: now,
    createdBy: "user",
    projectTargets: input.projectTargets || [],
    routing: input.routing || { currentAgent: input.agent || "assistant", manualOverride: { active: false } },
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
      required: ["product", "design", "engineering", "quality", "review", "deployment"],
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
  await appendJsonl(join(taskDir, "comments.jsonl"), { ts: now, type: "comment.system", actor: "system", taskId: id, body: "Task criada." });
  await appendJsonl(join(taskDir, "events.jsonl"), { ts: now, type: "task.created", actor: "user", taskId: id, task });
  return task;
}

export async function listTasks(rootInput) {
  const p = await initStorage(rootInput);
  const ids = await readdir(p.tasks);
  const tasks = await Promise.all(ids.map(async (id) => {
    const task = await readYaml(join(p.tasks, id, "task.yaml"));
    if (!task) return null;
    try {
      const description = (await readFile(join(p.tasks, id, "description.md"), "utf8")).replace(/^# .*\n\n?/, "").trim();
      return { ...task, description };
    } catch {
      return task;
    }
  }));
  return tasks.filter(Boolean);
}

export async function getTask(taskId, rootInput) {
  const p = paths(rootInput);
  return readYaml(join(p.tasks, taskId, "task.yaml"));
}

export async function updateTask(taskId, patch, rootInput, eventType = "task.updated") {
  const p = paths(rootInput);
  const taskPath = join(p.tasks, taskId, "task.yaml");
  const current = await readYaml(taskPath);
  if (!current) throw new Error(`Task not found: ${taskId}`);
  const updatedAt = new Date().toISOString();
  const task = { ...current, ...patch, updatedAt };
  await writeYaml(taskPath, task);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: updatedAt, type: eventType, actor: "user", taskId, patch });
  return task;
}

export async function writeTaskFile(taskId, relativePath, content, rootInput) {
  const p = paths(rootInput);
  const file = join(p.tasks, taskId, relativePath);
  await writeAtomic(file, content);
  return relativePath;
}

export async function moveTask(taskId, toColumn, rootInput) {
  const p = paths(rootInput);
  const taskPath = join(p.tasks, taskId, "task.yaml");
  const task = await readYaml(taskPath);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const from = task.column;
  task.column = toColumn;
  task.status = toColumn === "done" ? "done" : task.status;
  task.updatedAt = new Date().toISOString();
  await writeYaml(taskPath, task);
  await appendJsonl(join(p.tasks, taskId, "events.jsonl"), { ts: task.updatedAt, type: "task.moved", actor: "user", taskId, from, to: toColumn, patch: { column: task.column, status: task.status } });
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
  if (!agent?.instructionsPath) return agent;
  try {
    return { ...agent, instructionsBody: await readFile(join(settingsDir, "agents", agent.instructionsPath), "utf8") };
  } catch {
    return agent;
  }
}

export async function readSettingsScope(scope = "app", rootInput) {
  const p = await initStorage(rootInput);
  const normalized = scope || "app";
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
  return { scope: normalized, settings: app };
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
  if (["agents", "skills", "hooks", "projects"].includes(normalized)) {
    const dir = normalized === "projects" ? "projects" : normalized;
    const schema = `kanban-code-agent/${normalized.slice(0, -1)}@1`;
    const { instructionsBody, ...yamlPatch } = patch;
    const updated = await updateYamlById(dir, yamlPatch.id, yamlPatch, schema, rootInput);
    if (normalized === "agents" && typeof instructionsBody === "string") {
      const instructionsPath = updated.instructionsPath || `../prompts/${updated.id}.md`;
      await writeAtomic(join(p.settings, "agents", instructionsPath), instructionsBody);
    }
    return updated;
  }
  if (normalized === "board" || normalized === "columns" || normalized === "column-hooks") {
    const boardPath = join(p.settings, "boards", "default.yaml");
    const current = await readYaml(boardPath, { schema: "kanban-code-agent/board@1", id: "default", columns: [] });
    const boardPatch = normalized === "columns" ? { columns: patch.columns || patch } : patch;
    const board = deepMerge(current, boardPatch);
    await writeYaml(boardPath, board);
    await appendJsonl(join(p.runtime, "logs", "events.jsonl"), { ts: new Date().toISOString(), type: "settings.updated", actor: "user", scope: normalized });
    return board;
  }
  const appPath = join(p.settings, "app.yaml");
  const current = await readYaml(appPath, {});
  const appKey = appScopeKey(normalized);
  const settings = appKey ? deepMerge(current, { [appKey]: patch[appKey] || patch }) : deepMerge(current, patch);
  await writeYaml(appPath, settings);
  await appendJsonl(join(p.runtime, "logs", "events.jsonl"), { ts: new Date().toISOString(), type: "settings.updated", actor: "user", scope: normalized });
  return appKey ? { scope: normalized, [appKey]: settings[appKey] } : settings;
}

export async function readSettings(rootInput) {
  const p = await initStorage(rootInput);
  return readYaml(join(p.settings, "app.yaml"), {});
}

export async function readHook(hookId, rootInput) {
  const p = await initStorage(rootInput);
  return readYaml(join(p.settings, "hooks", `${hookId}.yaml`), null);
}

export async function readAgent(agentId, rootInput) {
  const p = await initStorage(rootInput);
  return readYaml(join(p.settings, "agents", `${agentId}.yaml`), null);
}

export async function readSkill(skillId, rootInput) {
  const p = await initStorage(rootInput);
  return (await readSkillMarkdown(join(p.settings, "skills", skillId), skillId)) || readYaml(join(p.settings, "skills", `${skillId}.yaml`), null);
}

export async function readProject(projectId, rootInput) {
  const p = await initStorage(rootInput);
  return readYaml(join(p.settings, "projects", `${projectId}.yaml`), null);
}

export async function rebuildTaskFromEvents(taskId, rootInput) {
  const p = await initStorage(rootInput);
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
  return rebuilt;
}

export async function rebuildIndexes(rootInput) {
  const p = await initStorage(rootInput);
  const tasks = await listTasks(rootInput);
  await writeAtomic(join(p.runtime, "indexes", "tasks.json"), JSON.stringify(tasks.map(({ id, title, column, status }) => ({ id, title, column, status })), null, 2));
  return { taskCount: tasks.length, indexPath: join(p.runtime, "indexes", "tasks.json") };
}

export async function boardSnapshot(rootInput) {
  const p = await initStorage(rootInput);
  const board = await readYaml(join(p.settings, "boards", "default.yaml"), { columns: [] });
  const tasks = await listTasks(rootInput);
  const settings = await readSettings(rootInput);
  return {
    schema: "kanban-code-agent/state@1",
    columns: board.columns || [],
    tasks,
    settings,
    events: await readJsonl(join(p.runtime, "logs", "events.jsonl"))
  };
}

export async function recordCommandResult(commandId, result, rootInput) {
  if (!commandId) return result;
  const p = await initStorage(rootInput);
  const file = join(p.runtime, "indexes", "commands", `${commandId}.json`);
  await writeAtomic(file, JSON.stringify(result, null, 2));
  return result;
}

export async function readCommandResult(commandId, rootInput) {
  if (!commandId) return null;
  const p = await initStorage(rootInput);
  try {
    return JSON.parse(await readFile(join(p.runtime, "indexes", "commands", `${commandId}.json`), "utf8"));
  } catch {
    return null;
  }
}
