export const columns = [
  { id: "inbox", label: "Entrada", agent: "assistant", autoStart: false, wip: null },
  { id: "definition", label: "Definição", agent: "architect", autoStart: true, wip: 3 },
  { id: "build", label: "Construção", agent: "engineer", autoStart: true, wip: 4 },
  { id: "validate", label: "Validação", agent: "validator", autoStart: true, wip: 2 },
  { id: "blocked", label: "Bloqueado", agent: null, autoStart: false, wip: null },
  { id: "done", label: "Pronto", agent: "reviewer", autoStart: false, wip: null }
];

export const agents = [
  { id: "assistant", label: "Assistant", status: "online" },
  { id: "architect", label: "Architect", status: "idle" },
  { id: "engineer", label: "Engineer", status: "running" },
  { id: "validator", label: "Validator", status: "idle" },
  { id: "reviewer", label: "Reviewer", status: "idle" }
];

export const tasks = [
  {
    id: "KCA-101",
    title: "Modelar FSDB em arquivos abertos",
    kind: "task",
    column: "definition",
    status: "running",
    priority: "high",
    projectTargets: ["kanban-code-agent"],
    branch: "kca/KCA-101",
    needs: [],
    provides: ["schema:task", "contract:fsdb"],
    fileLocks: ["packages/schemas/**", "packages/fsdb/**"]
  },
  {
    id: "KCA-200",
    title: "Integrar Pi SDK, worktrees e subtasks paralelas",
    kind: "master",
    column: "build",
    status: "queued",
    priority: "high",
    projectTargets: ["kanban-code-agent"],
    branch: "kca/KCA-200",
    needs: ["contract:fsdb"],
    provides: ["runtime:agent", "workflow:subtasks"],
    fileLocks: ["packages/pi-adapter/**", "packages/git-worktree/**"]
  }
];

export const settings = {
  schema: "kanban-code-agent/settings@1",
  app: { boardId: "default", theme: "system", localFirst: true },
  persistence: { taskStateFormat: "yaml", contextFormat: "markdown", eventsFormat: "jsonl" },
  runtime: { maxParallelTasks: 3, maxParallelMerges: 1, resumeSessions: true },
  worktrees: { createPerTask: true, subtaskFromParentFeature: true, mergeSubtaskIntoParent: true },
  projects: [{ id: "kanban-code-agent", label: "Kanban Code Agent", repo: process.cwd(), enabled: true }],
  agents
};

export function initialState() {
  return {
    schema: "kanban-code-agent/state@1",
    columns,
    tasks,
    settings,
    events: [
      { ts: new Date().toISOString(), type: "board.loaded", actor: "system" }
    ]
  };
}
