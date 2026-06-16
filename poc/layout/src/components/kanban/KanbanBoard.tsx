import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useKanbanStore } from '@/stores/kanbanStore';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { AgentColumn } from './AgentColumn';
import { TaskCard } from './TaskCard';
import { TaskDrawer } from './TaskDrawer';
import { CreateTaskDialog } from './CreateTaskDialog';
import { AGENTS } from '@/mocks/mockAgents';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import type { Task } from '@/types/task';

const COLUMNS = [
  { id: 'inbox', name: 'Inbox', icon: 'Inbox', color: '#94a3b8' },
  { id: 'manager', name: 'Manager', icon: 'ClipboardList', color: '#f59e0b' },
  {
    id: 'produto-generic',
    name: 'Produto',
    icon: 'Puzzle',
    color: '#a78bfa',
    isMulti: true,
    topAgent: AGENTS.find(a => a.id === 'produto')!,
    bottomAgent: AGENTS.find(a => a.id === 'generic')!,
  },
  {
    id: 'architecture-engineer',
    name: 'Architecture',
    icon: 'Building2',
    color: '#f472b6',
    isMulti: true,
    topAgent: AGENTS.find(a => a.id === 'architecture')!,
    bottomAgent: AGENTS.find(a => a.id === 'engineer')!,
  },
  {
    id: 'code-reviewer-qa',
    name: 'Code Reviewer',
    icon: 'SearchCode',
    color: '#2dd4bf',
    isMulti: true,
    topAgent: AGENTS.find(a => a.id === 'code-reviewer')!,
    bottomAgent: AGENTS.find(a => a.id === 'qa')!,
  },
  { id: 'done', name: 'Done', icon: 'CheckCircle2', color: '#34d399' },
];

export function KanbanBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks, moveTask } = useKanbanStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 12 } })
  );

  const { handleDragStart, handleDragEnd } = useDragAndDrop({
    onMove: (taskId, newAgent) => moveTask(taskId, newAgent),
  });

  const openTaskId = searchParams.get('task');
  const openTab = searchParams.get('tab') as 'chat' | 'workflow' | 'history' | 'summary' | null;

  const handleCloseDrawer = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('task');
    params.delete('tab');
    setSearchParams(params, { replace: true });
  };

  const getColumnTasks = (columnId: string): Record<string, Task[]> => {
    if (columnId === 'inbox') return { top: tasks.filter(t => t.assignedTo === 'inbox' || t.assignedTo === '') };
    if (columnId === 'manager') return { top: tasks.filter(t => t.assignedTo === 'manager') };
    if (columnId === 'produto-generic') return { top: tasks.filter(t => t.assignedTo === 'produto'), bottom: tasks.filter(t => t.assignedTo === 'generic') };
    if (columnId === 'architecture-engineer') return { top: tasks.filter(t => t.assignedTo === 'architecture'), bottom: tasks.filter(t => t.assignedTo === 'engineer') };
    if (columnId === 'code-reviewer-qa') return { top: tasks.filter(t => t.assignedTo === 'code-reviewer'), bottom: tasks.filter(t => t.assignedTo === 'qa') };
    if (columnId === 'done') return { top: tasks.filter(t => t.status === 'COMPLETED') };
    return { top: [] };
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={(event) => {
          handleDragStart(event);
          const task = tasks.find(t => t.id === event.active.id);
          if (task) setActiveTask(task);
        }}
        onDragEnd={(event) => {
          handleDragEnd(event);
          setActiveTask(null);
        }}
      >
        <div className="flex h-screen flex-col pt-14 bg-[radial-gradient(circle_at_top,rgba(124,124,255,0.06),transparent_34%)]">
          <div className="w-full overflow-x-auto overflow-y-hidden" style={{ height: 'calc(100vh - 3.5rem)' }}>
            <div className="flex h-full min-w-max items-stretch gap-4 p-4">
              {COLUMNS.map((col) => {
                const columnTasks = getColumnTasks(col.id);
                if (col.isMulti && col.topAgent && col.bottomAgent) {
                  return (
                    <AgentColumn
                      key={col.id}
                      id={col.id}
                      name={col.name}
                      icon={col.topAgent.icon}
                      color={col.topAgent.color}
                      tasks={columnTasks.top ?? []}
                      isMulti
                      subAgentName={col.bottomAgent.name}
                      subAgentColor={col.bottomAgent.color}
                      subAgentTasks={columnTasks.bottom ?? []}
                    />
                  );
                }
                const agent = AGENTS.find(a => a.name === col.name);
                return (
                  <AgentColumn
                    key={col.id}
                    id={col.id}
                    name={col.name}
                    icon={agent?.icon ?? 'Bot'}
                    color={agent?.color ?? col.color}
                    tasks={columnTasks.top ?? []}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      <Button
        className="fixed bottom-6 right-6 z-30 h-14 w-14 rounded-full border border-primary/20 bg-primary/90 shadow-lg shadow-primary/20 backdrop-blur-sm transition-all duration-300 hover:bg-primary hover:shadow-xl hover:shadow-primary/30"
        onClick={() => setCreateOpen(true)}
      >
        <Plus className="h-6 w-6" />
      </Button>

      <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />

      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
          defaultTab={openTab ?? 'chat'}
          onClose={handleCloseDrawer}
        />
      )}
    </>
  );
}
