import { cn } from '@/lib/utils';

export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const STATUS_CLASSES: Record<TaskStatus, string> = {
  PENDING: 'bg-muted-foreground/70 ring-1 ring-muted-foreground/20',
  QUEUED: 'bg-yellow-400/80 ring-1 ring-yellow-400/30',
  RUNNING: 'bg-emerald-400 animate-pulse ring-1 ring-emerald-400/40 shadow-sm shadow-emerald-400/20',
  WAITING: 'bg-blue-400/80 ring-1 ring-blue-400/30',
  COMPLETED: 'bg-emerald-500/90 ring-1 ring-emerald-500/40',
  FAILED: 'bg-red-400/90 ring-1 ring-red-400/40',
  CANCELLED: 'bg-muted-foreground/50 ring-1 ring-muted-foreground/20',
};

interface StatusDotProps {
  status: TaskStatus;
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full transition-all duration-200',
        STATUS_CLASSES[status],
        status === 'CANCELLED' && 'line-through opacity-50',
        className
      )}
      title={status}
    />
  );
}
