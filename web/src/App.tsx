import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navbar } from '@/components/layout/Navbar';
import { AnimatedGradientBackground } from '@/components/background/AnimatedGradientBackground';
import { useKanbanStore } from '@/stores/kanbanStore';
import { createWsClient } from '@/api/ws-client';
import { metadataToTask } from '@/api/adapter';

export function App() {
  const { fetchTasks, fetchAgents, setTasks } = useKanbanStore();

  useEffect(() => {
    // Fetch initial data
    fetchTasks();
    fetchAgents();

    // WebSocket for real-time updates
    const ws = createWsClient();

    ws.onState((stateTasks) => {
      if (Array.isArray(stateTasks)) {
        const tasks = (stateTasks as Array<Record<string, unknown>>).map((t) =>
          metadataToTask(t),
        );
        setTasks(tasks);
      }
    });

    ws.onStatus((connected) => {
      useKanbanStore.getState().setWsConnected(connected);
    });

    ws.onEvent((event, task) => {
      if (!event) return;
      console.debug('[board] apply', event.type, 'task=' + (event.taskId ?? '-'));
      if (event.type === 'TASK_ARCHIVED') {
        const ids = (event.payload?.archivedTaskIds as string[] | undefined) ?? (event.taskId ? [event.taskId] : []);
        ids.forEach((id) => useKanbanStore.getState().removeTask(id));
        return;
      }
      if (task) useKanbanStore.getState().upsertTask(metadataToTask(task));
      if (event.type === 'SUBTASK_CREATED' && event.parentId && event.taskId) {
        useKanbanStore.getState().linkSubtask(event.parentId, event.taskId);
      }
    });

    return () => ws.close();
  }, [fetchTasks, fetchAgents, setTasks]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-transparent text-foreground antialiased">
        <AnimatedGradientBackground />
        <Navbar />
        <Outlet />
      </div>
    </TooltipProvider>
  );
}
