import {
  Clock, ListOrdered, LoaderCircle, PauseCircle,
  CheckCircle, XCircle, Ban, Eye, MoonStar, MessageCircleQuestion,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUSPENDED' | 'REVIEW' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TaskWaitingReason = 'subtasks' | 'human' | 'validation';
export type FailureReason = 'attempts' | 'stagnation' | 'ceiling' | 'blocked' | 'human_timeout' | 'cancelled_by_user';

const STATUS_CONFIG: Record<TaskStatus, { icon: React.ComponentType<{ className?: string }>; label: string; cls: string }> = {
  PENDING:    { icon: Clock,         label: 'Pendente',   cls: 'bg-muted/60 text-muted-foreground border-muted-foreground/20' },
  QUEUED:     { icon: ListOrdered,   label: 'Na fila',    cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' },
  RUNNING:    { icon: LoaderCircle,  label: 'Executando', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 animate-pulse' },
  WAITING:    { icon: PauseCircle,   label: 'Aguardando', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  SUSPENDED:  { icon: MoonStar,      label: 'Suspensa',   cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  REVIEW:     { icon: Eye,           label: 'Revisão',    cls: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  COMPLETED:  { icon: CheckCircle,   label: 'Concluída',  cls: 'bg-emerald-600/10 text-emerald-500 border-emerald-600/30' },
  FAILED:     { icon: XCircle,       label: 'Falhou',     cls: 'bg-destructive/10 text-destructive border-destructive/30' },
  CANCELLED:  { icon: Ban,           label: 'Cancelada',  cls: 'bg-muted/40 text-muted-foreground/60 border-muted-foreground/15 line-through' },
};

const FAILURE_LABEL: Record<FailureReason, string> = {
  attempts: 'tentativas esgotadas',
  stagnation: 'estagnação',
  ceiling: 'teto excedido',
  blocked: 'bloqueada',
  human_timeout: 'timeout humano',
  cancelled_by_user: 'cancelada',
};

interface StatusBadgeProps {
  status: TaskStatus;
  waitingReason?: TaskWaitingReason;
  failureReason?: FailureReason;
  className?: string;
}

export function StatusBadge({ status, waitingReason, failureReason, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const Icon = status === 'WAITING' && waitingReason === 'human' ? MessageCircleQuestion : cfg.icon;
  let label = cfg.label;
  if (status === 'WAITING' && waitingReason === 'validation') label = 'Aguardando validação';
  else if (status === 'WAITING' && waitingReason === 'human') label = 'Aguardando humano';
  else if (status === 'FAILED' && failureReason) label = `Falhou (${FAILURE_LABEL[failureReason]})`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        cfg.cls,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function getStatusLabel(status: TaskStatus): string {
  return STATUS_CONFIG[status].label;
}
