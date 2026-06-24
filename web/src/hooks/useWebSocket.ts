import { useEffect, useRef, useCallback } from "react";
import { createWsClient, type WsClient } from "@/api/ws-client";
import { useKanbanStore } from "@/stores/kanbanStore";
import { metadataToTask } from "@/api/adapter";

interface UseWebSocketOptions {
  taskId?: string;
  autoConnect?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { taskId, autoConnect = true } = options;
  const clientRef = useRef<WsClient | null>(null);
  const setTasks = useKanbanStore((s) => s.setTasks);

  const connect = useCallback(
    (tid?: string) => {
      clientRef.current?.close();
      const client = createWsClient({ taskId: tid ?? taskId });
      clientRef.current = client;

      client.onState((stateTasks) => {
        if (Array.isArray(stateTasks)) {
          const tasks = (stateTasks as unknown[]).map((t: any) =>
            metadataToTask(t)
          );
          setTasks(tasks);
        }
      });

      client.onEvent((event, task) => {
        if (!event) return;
        if (event.type === "TASK_ARCHIVED") {
          const ids =
            (event.payload?.archivedTaskIds as string[] | undefined) ??
            (event.taskId ? [event.taskId] : []);
          ids.forEach((id) => useKanbanStore.getState().removeTask(id));
          return;
        }
        if (task) useKanbanStore.getState().upsertTask(metadataToTask(task));
      });
    },
    [taskId, setTasks]
  );

  const subscribe = useCallback(
    (tid: string) => {
      connect(tid);
    },
    [connect]
  );

  const unsubscribe = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();

      return () => {
        clientRef.current?.close();
        clientRef.current = null;
      };
    }
  }, [autoConnect, connect]);

  return { connect, subscribe, unsubscribe };
}
