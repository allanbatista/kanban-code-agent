const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:35000/ws';

export interface WsEvent {
  type: 'event' | 'state';
  event?: {
    seq: number;
    eventId: string;
    type: string;
    taskId?: string;
    parentId?: string;
    ts: string;
    messages?: Array<{
      ts: string;
      role: 'user' | 'assistant' | 'event';
      type: 'text' | 'artifact' | 'event';
      text?: string;
      artifacts?: Array<{
        description: string;
        fileType: string;
        path: string;
        sizeBytes?: number;
      }>;
      eventId?: string;
    }>;
    processedByTaskIds?: string[];
    payload?: Record<string, unknown>;
  };
  tasks?: Array<{
    taskId: string;
    title: string;
    assignedTo: string;
    parentId?: string;
    status: string;
    depth: number;
    subtaskIds: string[];
    runtimeConfig: { model?: string; effort?: string };
    metadata: {
      taskId: string;
      title: string;
      assignedTo: string;
      parentId?: string;
      status: string;
      depth: number;
      maxDepth: number;
      canCreateSubtasks: boolean;
      runtimeConfig: { model: string; effort: string };
      retryCount: number;
      technicalRetryCount: number;
      maxRetries: number;
      maxTechnicalRetries: number;
      maxSubtasksPerTask: number;
      runTimeoutMs: number;
      activeRunId?: string;
      runs: Array<{
        runId: string;
        status: string;
        waitGroups: Array<{
          waitId: string;
          mode: string;
          taskIds: string[];
          processedEventIds: string[];
          status: string;
        }>;
        startedAt?: string;
        completedAt?: string;
        error?: string;
      }>;
      taskChat: Array<{
        ts: string;
        role: string;
        type: string;
        text?: string;
      }>;
      artifacts: Array<{
        description: string;
        fileType: string;
        path: string;
        sizeBytes?: number;
      }>;
      metrics: {
        durationMs: number;
        tokens: { input: number; output: number; total: number };
        cost: number;
        startedAt?: string;
        finishedAt?: string;
      };
    };
    createdAt: string | null;
    updatedAt: string | null;
  }>;
}

type EventHandler = (event: WsEvent['event'] & object) => void;
type StateHandler = (tasks: WsEvent['tasks'] & object) => void;

export interface WsClient {
  onEvent: (handler: EventHandler) => () => void;
  onState: (handler: StateHandler) => () => void;
  close: () => void;
}

export function createWsClient(options?: { taskId?: string }): WsClient {
  const eventHandlers = new Set<EventHandler>();
  const stateHandlers = new Set<StateHandler>();

  let socket: WebSocket | null = null;
  let reconnectDelay = 1000;
  const maxReconnectDelay = 30000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      reconnectDelay = 1000;
      // subscribe when connected
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'subscribe', taskId: options?.taskId }));
      }
    };

    socket.onmessage = (raw: MessageEvent) => {
      try {
        const message: WsEvent = JSON.parse(raw.data as string);

        if (message.type === 'event' && message.event) {
          for (const handler of eventHandlers) {
            handler(message.event as WsEvent['event'] & object);
          }
        }

        if (message.type === 'state' && message.tasks) {
          for (const handler of stateHandlers) {
            handler(message.tasks as WsEvent['tasks'] & object);
          }
        }
      } catch {
        // ignore malformed
      }
    };

    socket.onclose = () => {
      if (closed) return;
      // exponential backoff reconnect
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay);
        connect();
      }, reconnectDelay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  }

  connect();

  return {
    onEvent(handler: EventHandler) {
      eventHandlers.add(handler);
      return () => { eventHandlers.delete(handler); };
    },
    onState(handler: StateHandler) {
      stateHandlers.add(handler);
      return () => { stateHandlers.delete(handler); };
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
