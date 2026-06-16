import { useNavigate, useSearchParams } from 'react-router-dom';
import { GitBranch, Clock } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusDot, getStatusLabel } from './StatusDot';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/task';

interface TaskCardProps {
  task: Task;
}

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    const params = new URLSearchParams(searchParams);
    params.set('task', task.id);
    params.set('tab', 'chat');
    navigate(`/?${params.toString()}`, { replace: true });
  };

  const handleDagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const params = new URLSearchParams(searchParams);
    params.set('task', task.id);
    params.set('tab', 'workflow');
    navigate(`/?${params.toString()}`, { replace: true });
  };

  const statusColor =
    task.status === 'RUNNING' ? 'var(--status-running)' :
    task.status === 'COMPLETED' ? 'var(--status-completed)' :
    task.status === 'FAILED' ? 'var(--status-failed)' :
    task.status === 'WAITING' ? 'var(--status-waiting)' :
    task.status === 'QUEUED' ? 'var(--status-queued)' :
    'var(--status-pending)';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card
        className={cn(
          'cursor-pointer border-l-[3px] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-l-primary hover:shadow-xl hover:shadow-black/20',
          isDragging && 'opacity-50 shadow-2xl ring-2 ring-primary/50 backdrop-blur-sm',
          task.status === 'RUNNING' && 'border-emerald-400/40 shadow-md shadow-emerald-400/10'
        )}
        style={{ borderLeftColor: statusColor } as React.CSSProperties}
        onClick={handleClick}
      >
        <p className="mb-2 truncate text-sm font-medium leading-tight">{task.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-[10px]">#{task.id.slice(0, 8)}</span>
          <StatusDot status={task.status} />
          <span className={cn('text-[10px]', task.status === 'CANCELLED' && 'line-through')}>
            {getStatusLabel(task.status)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {task.metrics.durationMs > 0 && (
              <>
                <Clock className="h-3 w-3" />
                <span>{formatDuration(task.metrics.durationMs)}</span>
              </>
            )}
            {task.runtimeConfig && (
              <Badge variant="outline" className="h-4 px-1 py-0 text-[9px] border-border/60 bg-background/50">
                {task.runtimeConfig.model}/{task.runtimeConfig.effort}
              </Badge>
            )}
          </div>
          <button
            onClick={handleDagClick}
            className="text-muted-foreground transition-colors hover:text-foreground"
            title="Visualizar workflow"
          >
            <GitBranch className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
