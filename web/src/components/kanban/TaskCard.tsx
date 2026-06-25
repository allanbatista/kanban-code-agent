import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GitBranch, Clock } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { StatusBadge } from './StatusBadge';
import { useKanbanStore } from '@/stores/kanbanStore';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/task';

interface TaskCardProps {
  task: Task;
}

export const TREE_COLORS = [
  '#7c7cff', '#f472b6', '#34d399', '#fbbf24', '#60a5fa',
  '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#94a3b8',
];

export function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function defaultTreeColor(rootId: string): string {
  return TREE_COLORS[hashId(rootId) % TREE_COLORS.length];
}

export function TaskCard({ task }: TaskCardProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tasks, familyColors, getTaskRootId } = useKanbanStore();

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

  const rootId = useMemo(() => getTaskRootId(task.id), [task.id, getTaskRootId]);
  const treeColor = familyColors[rootId] ?? defaultTreeColor(rootId);
  const parentId = useMemo(() => findParent(task.id, tasks), [task.id, tasks]);

  const openTaskModal = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    const params = new URLSearchParams(searchParams);
    params.set('task', taskId);
    params.set('tab', 'chat');
    navigate(`/?${params.toString()}`, { replace: true });
  };

  const createdAt = task.metrics.startedAt
    ? new Date(task.metrics.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  const shortId = (id: string) => `#${id.slice(0, 8)}`;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="group">
      <Card
        className={cn(
          'cursor-pointer border-l-[6px] p-[10px] transition-all duration-200 bg-transparent',
          'group-hover:bg-black/20 group-hover:scale-[1.025] group-hover:shadow-lg group-hover:shadow-black/30',
          isDragging && 'opacity-50 shadow-2xl ring-2 ring-primary/50'
        )}
        style={{ borderLeftColor: treeColor } as React.CSSProperties}
        onClick={handleClick}
      >
        {/* Meta: ID + data + duração + workflow */}
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[10px] text-muted-foreground/60 group-hover:text-white/90 shrink-0">{shortId(task.id)}</span>
            {createdAt && (
              <span className="text-[10px] text-muted-foreground/50 group-hover:text-white/80 shrink-0">{createdAt}</span>
            )}
            {task.metrics.durationMs > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/50 group-hover:text-white/80 shrink-0">
                <span>·</span>
                <Clock className="h-2.5 w-2.5" />
                {formatDuration(task.metrics.durationMs)}
              </span>
            )}
          </div>
          <button
            onClick={handleDagClick}
            className="text-muted-foreground/40 transition-colors hover:text-foreground group-hover:text-white shrink-0"
            title="Visualizar workflow"
          >
            <GitBranch className="h-3 w-3" />
          </button>
        </div>

        {/* Título */}
        <p className="mb-2 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-tight group-hover:text-white">{task.title}</p>

        {/* Status + ancestors */}
        <div className="flex items-center justify-between gap-1">
          <StatusBadge status={task.status} waitingReason={task.waitingReason} />
          {(rootId !== task.id || parentId) && (
            <div className="flex items-center gap-1">
              {parentId && parentId !== rootId && (
                <button
                  onClick={(e) => openTaskModal(e, parentId)}
                  className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-500/20 transition-colors group-hover:bg-amber-500/20 group-hover:text-amber-300 font-mono"
                  title={`Parent: ${parentId}`}
                >
                  {shortId(parentId)}
                </button>
              )}
              <button
                onClick={(e) => openTaskModal(e, rootId)}
                className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400 hover:bg-violet-500/20 transition-colors group-hover:bg-violet-500/20 group-hover:text-violet-300 font-mono"
                title={`Main: ${rootId}`}
              >
                {shortId(rootId)}
              </button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function findParent(taskId: string, allTasks: Task[]): string | null {
  for (const t of allTasks) {
    if (t.subtaskIds.includes(taskId)) return t.id;
  }
  return null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
