import { useEffect, useRef, useCallback } from "react";
import { createWsClient, type WsClient } from "@/api/ws-client";
import { useKanbanStore } from "@/stores/kanbanStore";
import { apiTaskToTask } from "@/api/adapter";

interface UseWebSocketOptions {
  taskId?: string;
  autoConnect?: boolean;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { taskId, autoConnect = true } = options;
  const clientRef = useRef<WsClient | null>(null);
  const fetchTasks = useKanbanStore((s) => s.fetchTasks);
  const setTasks = useKanbanStore((s) => s.setTasks);

  const connect = useCallback(
    (tid?: string) => {
      clientRef.current?.close();
      const client = createWsClient({ taskId: tid ?? taskId });
      clientRef.current = client;

      client.onState((stateTasks) => {
        if (Array.isArray(stateTasks)) {
          const tasks = (stateTasks as unknown[]).map((t: any) =>
            apiTaskToTask(t as Parameters<typeof apiTaskToTask>[0])
          );
          setTasks(tasks);
        }
      });

      client.onEvent(() => {
        fetchTasks();
      });
    },
    [taskId, fetchTasks, setTasks]
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
