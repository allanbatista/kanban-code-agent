import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import * as LucideIcons from 'lucide-react';
import { StatusBadge } from '@/components/kanban/StatusBadge';
import { cn } from '@/lib/utils';
import type { TaskStatus } from '@/components/kanban/StatusBadge';

export interface TaskNodeData extends Record<string, unknown> {
  label: string;
  status: TaskStatus;
  agent: string;
  icon: string;
  color: string;
  treeColor: string;
  isRoot: boolean;
  metrics: { tokens: { total: number }; cost: number; durationMs: number };
}

export type WorkflowTaskNode = Node<TaskNodeData, 'taskNode'>;

const iconMap = LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>;

export function TaskNode({ data, selected }: NodeProps<WorkflowTaskNode>) {
  const { label, status, agent, icon, color, treeColor, isRoot, metrics } = data;
  const AgentIcon = iconMap[icon] ?? LucideIcons.Bot;

  return (
    <div
      className={cn(
        'min-w-[200px] max-w-[260px] rounded-2xl border border-border/60 bg-card/90 px-3 py-2 shadow-xl shadow-black/25 backdrop-blur-sm transition-all duration-200',
        selected && 'ring-2 ring-primary/60',
        isRoot && 'border-primary/50'
      )}
      style={{ borderLeftColor: treeColor, borderLeftWidth: 3 } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="mb-1.5 flex items-center gap-1.5">
        <StatusBadge status={status} />
      </div>
      <p className="truncate text-sm font-medium leading-tight text-foreground/95">{label}</p>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
        <AgentIcon className="h-3 w-3" style={{ color }} />
        <span className="text-muted-foreground/50">{agent}</span>
        <span>·</span>
        <span>{metrics.tokens.total} tok</span>
        <span>·</span>
        <span>{formatDuration(metrics.durationMs)}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
