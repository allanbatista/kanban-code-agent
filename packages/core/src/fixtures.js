export const columns = [
  { id: "inbox", label: "Entrada", agent: "assistant", autoStart: false, wip: null },
  { id: "manager", label: "Manager", agent: "manager", role: "manager", autoStart: true, wip: 2 },
  { id: "product", label: "Produto", agent: "product", role: "product", autoStart: true, wip: 3 },
  { id: "design", label: "Design", agent: "design", role: "design", autoStart: true, wip: 2 },
  { id: "architecture", label: "Arquitetura", agent: "architecture", role: "architecture", autoStart: true, wip: 2 },
  { id: "generalist", label: "Generalista", agent: "generalist", role: "generalist", autoStart: true, wip: 3 },
  { id: "engineering", label: "Engenharia", agent: "engineering", role: "engineering", autoStart: true, wip: 4 },
  { id: "quality", label: "Qualidade", agent: "quality", role: "quality", autoStart: true, wip: 2 },
  { id: "review", label: "Review", agent: "review", role: "review", autoStart: true, wip: 2 },
  { id: "deployment", label: "Deployment", agent: "deployment", role: "deployment", autoStart: false, wip: 1 },
  { id: "human_wait", label: "Aguardando Humano", agent: null, role: "manager", autoStart: false, wip: null },
  { id: "done", label: "Pronto", agent: null, role: null, autoStart: false, wip: null }
];

export const agents = [
  { id: "assistant", label: "Assistant", status: "online" },
  { id: "manager", label: "Manager", status: "idle" },
  { id: "product", label: "Product", status: "idle" },
  { id: "design", label: "Design", status: "idle" },
  { id: "architecture", label: "Architecture", status: "idle" },
  { id: "engineering", label: "Engineering", status: "running" },
  { id: "quality", label: "Quality", status: "idle" },
  { id: "review", label: "Review", status: "idle" },
  { id: "deployment", label: "Deployment", status: "idle" },
  { id: "generalist", label: "Generalist", status: "idle" }
];

export const tasks = [
  {
    id: "KCA-101",
    title: "Modelar FSDB em arquivos abertos",
    kind: "task",
    column: "product",
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
    column: "engineering",
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
