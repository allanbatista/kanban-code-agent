import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { forwardRef } from 'react';
import * as LucideIcons from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskCard } from './TaskCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/task';

interface AgentColumnProps {
  id: string;
  name: string;
  icon: string;
  color: string;
  tasks: Task[];
  isMulti?: boolean;
  subAgentName?: string;
  subAgentColor?: string;
  subAgentTasks?: Task[];
}

interface AgentPanelProps {
  name: string;
  icon: string;
  color: string;
  tasks: Task[];
  className?: string;
}

const AgentPanel = forwardRef<HTMLDivElement, AgentPanelProps>(function AgentPanel(
  { name, icon, color, tasks, className },
  ref
) {
  const IconComponent = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>>)[icon] ?? LucideIcons.Bot;
  const runningCount = tasks.filter(t => t.status === 'RUNNING').length;

  return (
    <div
      ref={ref}
      style={{ height: '100%' }}
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-xl shadow-black/20 backdrop-blur-sm', className)}
    >
      <div className="mb-3 flex items-center justify-between border-b border-border/50 bg-background/30 px-3 py-[10px]">
        <div className="flex items-center gap-2">
          <IconComponent className="h-4 w-4" style={{ color }} />
          <span className="text-sm font-medium">{name}</span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-xs border-border/60 bg-background/50',
            runningCount > 0 ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'text-muted-foreground'
          )}
        >
          {runningCount}/{tasks.length}
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2 pb-2">
            {tasks.length === 0 ? (
              <EmptyState title="Sem tasks" className="py-6" />
            ) : (
              tasks.map(task => <TaskCard key={task.id} task={task} />)
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
});
AgentPanel.displayName = 'AgentPanel';

export function AgentColumn({ id, name, icon, color, tasks, isMulti, subAgentName, subAgentColor, subAgentTasks }: AgentColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${id}` });

  if (isMulti && subAgentName !== undefined && subAgentTasks !== undefined) {
    return (
      <div
        ref={setNodeRef}
        style={{ height: '100%' }}
        className={cn(
          'flex h-full min-h-0 min-w-[280px] flex-1 flex-col gap-4 rounded-2xl',
          isOver && 'ring-2 ring-primary/60'
        )}
      >
        <AgentPanel name={name} icon={icon} color={color} tasks={tasks} className="flex-1" />
        <AgentPanel
          name={subAgentName}
          icon="Bot"
          color={subAgentColor ?? color}
          tasks={subAgentTasks}
          className="flex-1"
        />
      </div>
    );
  }

  return (
    <AgentPanel
      ref={setNodeRef}
      name={name}
      icon={icon}
      color={color}
      tasks={tasks}
      className={cn('h-full min-w-[280px]', isOver && 'ring-2 ring-primary/60')}
    />
  );
}
