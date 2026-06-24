import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navbar } from '@/components/layout/Navbar';
import { AnimatedGradientBackground } from '@/components/background/AnimatedGradientBackground';
import { useKanbanStore } from '@/stores/kanbanStore';
import { createWsClient } from '@/api/ws-client';
import { metadataToTask } from '@/api/adapter';

export function App() {
  const { fetchTasks, fetchAgents, setTasks } = useKanbanStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

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

    ws.onEvent((event, task) => {
      if (!event) return;
      if (event.type === 'TASK_ARCHIVED') {
        const ids = (event.payload?.archivedTaskIds as string[] | undefined) ?? (event.taskId ? [event.taskId] : []);
        ids.forEach((id) => useKanbanStore.getState().removeTask(id));
        return;
      }
      if (task) useKanbanStore.getState().upsertTask(metadataToTask(task));
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
