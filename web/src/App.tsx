import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Navbar } from '@/components/layout/Navbar';
import { AnimatedGradientBackground } from '@/components/background/AnimatedGradientBackground';
import { useKanbanStore } from '@/stores/kanbanStore';
import { createWsClient } from '@/api/ws-client';
import { apiTaskToTask } from '@/api/adapter';

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
          apiTaskToTask(t as unknown as Parameters<typeof apiTaskToTask>[0]),
        );
        setTasks(tasks);
      }
    });

    ws.onEvent((event) => {
      // Re-fetch tasks on any swarm event to stay in sync
      fetchTasks();
      void event; // keep reference without unused warning
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
