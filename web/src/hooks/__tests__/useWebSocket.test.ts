// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock ws-client module
const mockCreateWsClient = vi.fn();
vi.mock("@/api/ws-client", () => ({
  createWsClient: (...args: unknown[]) => mockCreateWsClient(...args),
}));

// Mock kanban store
const mockFetchTasks = vi.fn();
const mockSetTasks = vi.fn();
vi.mock("@/stores/kanbanStore", () => ({
  useKanbanStore: (selector: (s: any) => any) =>
    selector({
      fetchTasks: mockFetchTasks,
      setTasks: mockSetTasks,
    }),
}));

// Mock adapter
vi.mock("@/api/adapter", () => ({
  apiTaskToTask: (t: any) => ({ ...t, id: t.taskId }),
}));

describe("useWebSocket (T03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockClient() {
    return {
      onEvent: vi.fn().mockReturnValue(vi.fn()),
      onState: vi.fn().mockReturnValue(vi.fn()),
      close: vi.fn(),
    };
  }

  it("returns connect, subscribe, unsubscribe functions", async () => {
    mockCreateWsClient.mockReturnValue(makeMockClient());

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ autoConnect: false }));

    expect(result.current).toHaveProperty("connect");
    expect(result.current).toHaveProperty("subscribe");
    expect(result.current).toHaveProperty("unsubscribe");
  });

  it("calls createWsClient on connect", async () => {
    mockCreateWsClient.mockReturnValue(makeMockClient());

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ autoConnect: false }));

    act(() => {
      result.current.connect("task_123");
    });

    expect(mockCreateWsClient).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task_123" })
    );
  });

  it("closes previous client before reconnecting", async () => {
    const closeMock = vi.fn();
    const mockClient1 = { ...makeMockClient(), close: closeMock };
    const mockClient2 = makeMockClient();
    mockCreateWsClient.mockReturnValueOnce(mockClient1).mockReturnValueOnce(mockClient2);

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ autoConnect: false }));

    act(() => result.current.connect("task_001"));
    act(() => result.current.connect("task_002"));

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(mockCreateWsClient).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe closes client", async () => {
    const closeMock = vi.fn();
    mockCreateWsClient.mockReturnValue({ ...makeMockClient(), close: closeMock });

    const { useWebSocket } = await import("@/hooks/useWebSocket");
    const { result } = renderHook(() => useWebSocket({ autoConnect: false }));

    act(() => result.current.connect());
    act(() => result.current.unsubscribe());

    expect(closeMock).toHaveBeenCalled();
  });
});
