import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock API
const mockGetTasks = vi.fn();
const mockGetAgents = vi.fn();
const mockCreateTask = vi.fn();
const mockCancelTask = vi.fn();
const mockUpdateTask = vi.fn();

vi.mock("@/api/client", () => ({
  api: {
    getTasks: (...args: unknown[]) => mockGetTasks(...args),
    getAgents: (...args: unknown[]) => mockGetAgents(...args),
    createTask: (...args: unknown[]) => mockCreateTask(...args),
    cancelTask: (...args: unknown[]) => mockCancelTask(...args),
    updateTask: (...args: unknown[]) => mockUpdateTask(...args),
  },
}));

// Mock adapter
vi.mock("@/api/adapter", () => ({
  apiTaskToTask: (t: any) => ({
    id: t.taskId,
    title: t.title,
    assignedTo: t.assignedTo,
    parentId: t.parentId,
    status: t.status,
    depth: t.depth,
    subtaskIds: t.subtaskIds || [],
    runtimeConfig: { model: "balanced", effort: "medium" },
    chat: [],
    artifacts: [],
    attachments: [],
    metrics: {
      durationMs: 0,
      waitingMs: 0,
      tokens: { input: 0, output: 0, total: 0, cache: 0 },
      cost: 0,
    },
    retryCount: 0,
    runs: [],
  }),
  apiAgentToAgent: (a: any) => ({
    id: a.name,
    name: a.name.charAt(0).toUpperCase() + a.name.slice(1),
    icon: "Bot",
    color: "#94a3b8",
  }),
}));

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "T1",
    assignedTo: "engineer",
    status: "PENDING" as const,
    depth: 0,
    subtaskIds: [] as string[],
    runtimeConfig: { model: "balanced" as const, effort: "medium" as const },
    chat: [],
    artifacts: [],
    attachments: [],
    metrics: {
      durationMs: 0,
      waitingMs: 0,
      tokens: { input: 0, output: 0, total: 0, cache: 0 },
      cost: 0,
    },
    retryCount: 0,
    runs: [],
    ...overrides,
  };
}

describe("kanban-store (T04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchTasks loads tasks from API", async () => {
    mockGetTasks.mockResolvedValueOnce({
      tasks: [
        {
          taskId: "t1",
          title: "Task 1",
          assignedTo: "engineer",
          status: "RUNNING",
          depth: 0,
          subtaskIds: [],
          runtimeConfig: {},
          createdAt: null,
          updatedAt: null,
        },
      ],
      total: 1,
    });

    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({ tasks: [], loading: false, error: null });

    await useKanbanStore.getState().fetchTasks();

    const state = useKanbanStore.getState();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe("t1");
    expect(state.loading).toBe(false);
    expect(mockGetTasks).toHaveBeenCalled();
  });

  it("linkSubtask attaches a new subtask to its parent (idempotent)", async () => {
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({ tasks: [makeTask({ id: "p1", subtaskIds: [] })] });

    useKanbanStore.getState().linkSubtask("p1", "c1");
    expect(useKanbanStore.getState().tasks[0].subtaskIds).toEqual(["c1"]);

    useKanbanStore.getState().linkSubtask("p1", "c1");
    expect(useKanbanStore.getState().tasks[0].subtaskIds).toEqual(["c1"]);
  });

  it("fetchTasks sets error on failure", async () => {
    mockGetTasks.mockRejectedValueOnce(new Error("API down"));

    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({ tasks: [], loading: false, error: null });

    await useKanbanStore.getState().fetchTasks();

    const state = useKanbanStore.getState();
    expect(state.error).toBe("Error: API down");
    expect(state.loading).toBe(false);
  });

  it("createTask sends POST and adds to state", async () => {
    mockCreateTask.mockResolvedValueOnce({
      taskId: "new_1",
      title: "New task",
      assignedTo: "engineer",
      status: "PENDING",
      depth: 0,
      subtaskIds: [],
      runtimeConfig: {},
      createdAt: null,
      updatedAt: null,
    });

    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({ tasks: [], loading: false, error: null });

    const task = await useKanbanStore.getState().createTask({
      message: "New task",
    });

    expect(task.id).toBe("new_1");
    expect(useKanbanStore.getState().tasks).toHaveLength(1);
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ message: "New task" })
    );
  });

  it("createTask dedupes when the WS stream already inserted the real task", async () => {
    mockCreateTask.mockResolvedValueOnce({
      taskId: "task_22",
      title: "Race task",
      assignedTo: "manager",
      status: "PENDING",
      depth: 0,
      subtaskIds: [],
      runtimeConfig: {},
      createdAt: null,
      updatedAt: null,
    });

    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({ tasks: [], loading: false, error: null });

    const promise = useKanbanStore.getState().createTask({ message: "Race task" });
    // Simulate the WS event landing before the POST resolves.
    useKanbanStore.getState().upsertTask(makeTask({ id: "task_22" }));
    await promise;

    const ids = useKanbanStore.getState().tasks.map((t) => t.id);
    expect(ids.filter((id) => id === "task_22")).toHaveLength(1);
  });

  it("moveTask to inbox parks the task and calls the API", async () => {
    mockUpdateTask.mockResolvedValueOnce({});
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [makeTask()],
      loading: false,
      error: null,
    });

    await useKanbanStore.getState().moveTask("t1", "inbox");

    const state = useKanbanStore.getState();
    expect(state.tasks[0].assignedTo).toBe("inbox");
    expect(state.tasks[0].status).toBe("PENDING");
    expect(mockUpdateTask).toHaveBeenCalledWith("t1", { assignedTo: "inbox" });
  });

  it("moveTask ignores non-permitted targets", async () => {
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [makeTask()],
      loading: false,
      error: null,
    });

    await useKanbanStore.getState().moveTask("t1", "qa");

    expect(useKanbanStore.getState().tasks[0].assignedTo).toBe("engineer");
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("moveTask rolls back on API failure", async () => {
    mockUpdateTask.mockRejectedValueOnce(new Error("boom"));
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [makeTask({ assignedTo: "manager" })],
      loading: false,
      error: null,
    });

    await expect(useKanbanStore.getState().moveTask("t1", "inbox")).rejects.toThrow();

    const state = useKanbanStore.getState();
    expect(state.tasks[0].assignedTo).toBe("manager");
    expect(state.error).toBe("boom");
  });

  it("getFamilyTasks traverses subtask tree", async () => {
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [
        makeTask({ id: "root", subtaskIds: ["child1", "child2"] }),
        makeTask({ id: "child1", depth: 1, subtaskIds: ["grandchild"] }),
        makeTask({ id: "child2", depth: 1, subtaskIds: [] }),
        makeTask({ id: "grandchild", depth: 2, subtaskIds: [] }),
      ],
      loading: false,
      error: null,
    });

    const family = useKanbanStore.getState().getFamilyTasks("root");
    expect(family).toEqual(["root", "child1", "child2", "grandchild"]);
  });

  it("getTaskRootId finds root ancestor", async () => {
    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [
        makeTask({ id: "root", subtaskIds: ["child1"] }),
        makeTask({ id: "child1", depth: 1, subtaskIds: ["grandchild"] }),
        makeTask({ id: "grandchild", depth: 2, subtaskIds: [] }),
      ],
      loading: false,
      error: null,
    });

    const rootId = useKanbanStore.getState().getTaskRootId("grandchild");
    expect(rootId).toBe("root");
  });

  it("cancelTask calls API and updates status locally", async () => {
    mockCancelTask.mockResolvedValueOnce(undefined);

    const { useKanbanStore } = await import("@/stores/kanbanStore");
    useKanbanStore.setState({
      tasks: [makeTask()],
      loading: false,
      error: null,
    });

    await useKanbanStore.getState().cancelTask("t1");

    expect(mockCancelTask).toHaveBeenCalledWith("t1");
    expect(useKanbanStore.getState().tasks[0].status).toBe("CANCELLED");
  });
});
