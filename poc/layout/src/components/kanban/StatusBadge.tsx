import {
  Clock, ListOrdered, LoaderCircle, PauseCircle,
  CheckCircle, XCircle, Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const STATUS_CONFIG: Record<TaskStatus, { icon: React.ComponentType<{ className?: string }>; label: string; cls: string }> = {
  PENDING:    { icon: Clock,         label: 'Pendente',   cls: 'bg-muted/60 text-muted-foreground border-muted-foreground/20' },
  QUEUED:     { icon: ListOrdered,   label: 'Na fila',    cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  RUNNING:    { icon: LoaderCircle,  label: 'Executando', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 animate-pulse' },
  WAITING:    { icon: PauseCircle,   label: 'Aguardando', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  COMPLETED:  { icon: CheckCircle,   label: 'Concluída',  cls: 'bg-emerald-600/10 text-emerald-500 border-emerald-600/30' },
  FAILED:     { icon: XCircle,       label: 'Falhou',     cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  CANCELLED:  { icon: Ban,           label: 'Cancelada',  cls: 'bg-muted/40 text-muted-foreground/60 border-muted-foreground/15 line-through' },
};

interface StatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        cfg.cls,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

export function getStatusLabel(status: TaskStatus): string {
  return STATUS_CONFIG[status].label;
}
