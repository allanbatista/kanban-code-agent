import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import { TaskNode } from './TaskNode';
import { AnimatedEdge } from './AnimatedEdge';
import type { Task } from '@/types/task';

const nodeTypes = { taskNode: TaskNode };
const edgeTypes = { animated: AnimatedEdge };

interface WorkflowViewProps {
  task: Task;
  allTasks?: Task[];
  onNodeClick?: (taskId: string) => void;
}

export function WorkflowView({ task, allTasks = [], onNodeClick }: WorkflowViewProps) {
  const { nodes, edges } = useMemo(() => buildDag(task, allTasks), [task, allTasks]);

  return (
    <div className="h-full min-h-[400px] w-full rounded-b-2xl bg-[radial-gradient(circle_at_top,rgba(124,124,255,0.08),transparent_36%),linear-gradient(180deg,rgba(17,24,39,0.35),rgba(17,24,39,0.1))]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'animated', animated: true }}
        fitView
        attributionPosition="bottom-left"
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
      >
        <Background gap={18} color="rgba(148, 163, 184, 0.16)" />
        <Controls className="!rounded-xl !border !border-border/60 !bg-card/90 !text-foreground !shadow-xl !shadow-black/20" />
        <MiniMap
          className="!rounded-xl !border !border-border/60 !bg-card/90"
          nodeColor={(node) => (node.data as { color?: string }).color ?? 'var(--primary)'}
        />
      </ReactFlow>
    </div>
  );
}

interface LayoutNode {
  id: string;
  title: string;
  status: string;
  assignedTo: string;
  color: string;
  isRoot: boolean;
  metrics: { tokens: { total: number }; cost: number; durationMs: number };
  parentId?: string;
  x: number;
  y: number;
}

function buildDag(rootTask: Task, allTasks: Task[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const taskMap = new Map<string, Task>();
  taskMap.set(rootTask.id, rootTask);
  for (const t of allTasks) taskMap.set(t.id, t);

  const AGENT_COLORS: Record<string, string> = {
    manager: '#f59e0b',
    produto: '#a78bfa',
    generic: '#94a3b8',
    architecture: '#f472b6',
    engineer: '#60a5fa',
    'code-reviewer': '#2dd4bf',
    qa: '#fb923c',
  };

  const collectTree = (task: Task, depth: number, index: number): LayoutNode[] => {
    const result: LayoutNode[] = [];
    const siblingsX = (index - 0.5) * 300;
    result.push({
      id: task.id,
      title: task.title,
      status: task.status,
      assignedTo: task.assignedTo,
      color: AGENT_COLORS[task.assignedTo] ?? '#94a3b8',
      isRoot: task.id === rootTask.id,
      metrics: task.metrics,
      x: siblingsX,
      y: depth * 150,
      parentId: task.parentId,
    });
    let childIndex = 0;
    for (const subtaskId of task.subtaskIds) {
      const subtask = taskMap.get(subtaskId);
      if (subtask) {
        const children = collectTree(subtask, depth + 1, childIndex);
        childIndex++;
        for (const child of children) {
          child.x += siblingsX;
          result.push(child);
        }
      }
    }
    return result;
  };

  const layout = collectTree(rootTask, 0, 0);

  for (const node of layout) {
    nodes.push({
      id: node.id,
      type: 'taskNode',
      position: { x: node.x, y: node.y },
      data: {
        label: node.title,
        status: node.status,
        agent: node.assignedTo,
        color: node.color,
        isRoot: node.isRoot,
        metrics: node.metrics,
      },
    });

    if (node.parentId) {
      edges.push({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        type: 'animated',
        animated: node.status === 'RUNNING',
        style: {
          stroke: node.status === 'RUNNING' ? 'var(--status-running)' :
                  node.status === 'COMPLETED' ? 'var(--status-completed)' :
                  node.status === 'FAILED' ? 'var(--status-failed)' :
                  'var(--muted-foreground)',
          strokeWidth: 2,
        },
      } as Edge);
    }
  }

  return { nodes, edges };
}
