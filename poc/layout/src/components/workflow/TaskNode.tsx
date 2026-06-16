import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from '@/lib/utils';

export interface TaskNodeData extends Record<string, unknown> {
  label: string;
  status: string;
  agent: string;
  color: string;
  isRoot: boolean;
  metrics: { tokens: { total: number }; cost: number; durationMs: number };
}

export type WorkflowTaskNode = Node<TaskNodeData, 'taskNode'>;

export function TaskNode({ data, selected }: NodeProps<WorkflowTaskNode>) {
  const { label, status, agent, color, isRoot, metrics } = data;

  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[240px] rounded-2xl border border-border/60 bg-card/90 px-3 py-2 shadow-xl shadow-black/25 backdrop-blur-sm transition-all duration-200',
        selected && 'ring-2 ring-primary/60',
        status === 'RUNNING' && 'border-emerald-400/40 shadow-emerald-400/10',
        isRoot && 'border-primary/50'
      )}
      style={{ borderLeftColor: color, borderLeftWidth: 3 } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="mb-1 flex items-center gap-2">
        <StatusBadge status={status} />
        <span className="text-xs text-muted-foreground/75">{agent}</span>
      </div>
      <p className="truncate text-sm font-medium leading-tight text-foreground/95">{label}</p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/75">
        <span>{metrics.tokens.total} tok</span>
        <span>·</span>
        <span>{formatDuration(metrics.durationMs)}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    RUNNING: 'bg-emerald-400',
    COMPLETED: 'bg-emerald-500',
    FAILED: 'bg-rose-400',
    WAITING: 'bg-sky-400',
    QUEUED: 'bg-amber-400',
    PENDING: 'bg-slate-400',
    CANCELLED: 'bg-slate-500',
  };
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/20', colors[status] ?? 'bg-slate-400')} />;
}

function formatDuration(ms: number): string {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
