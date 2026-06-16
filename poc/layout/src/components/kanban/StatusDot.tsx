/* eslint-disable react-refresh/only-export-components */
import { cn } from '@/lib/utils';

export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const STATUS_CLASSES: Record<TaskStatus, string> = {
  PENDING: 'bg-muted-foreground',
  QUEUED: 'bg-yellow-500',
  RUNNING: 'bg-green-500 animate-pulse',
  WAITING: 'bg-blue-500',
  COMPLETED: 'bg-emerald-500',
  FAILED: 'bg-destructive',
  CANCELLED: 'bg-muted-foreground',
};

interface StatusDotProps {
  status: TaskStatus;
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        STATUS_CLASSES[status],
        status === 'CANCELLED' && 'line-through opacity-50',
        className
      )}
      title={status}
    />
  );
}

export function getStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    PENDING: 'pending',
    QUEUED: 'queued',
    RUNNING: 'running',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  };
  return labels[status];
}
