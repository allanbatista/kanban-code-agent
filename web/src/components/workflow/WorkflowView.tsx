import { useMemo } from 'react';
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import { TaskNode } from './TaskNode';
import { AnimatedEdge } from './AnimatedEdge';
import { useKanbanStore } from '@/stores/kanbanStore';
import { defaultTreeColor } from '@/components/kanban/TaskCard';
import type { Task } from '@/types/task';
import type { TaskStatus } from '@/components/kanban/StatusBadge';

const nodeTypes = { taskNode: TaskNode };
const edgeTypes = { animated: AnimatedEdge };

interface WorkflowViewProps {
  task: Task;
  allTasks?: Task[];
  onNodeClick?: (taskId: string) => void;
}

export function WorkflowView({ task, allTasks = [], onNodeClick }: WorkflowViewProps) {
  const { familyColors, getTaskRootId } = useKanbanStore();
  const { nodes, edges } = useMemo(() => buildDag(task, allTasks, familyColors, getTaskRootId), [task, allTasks, familyColors, getTaskRootId]);

  return (
    <div className="h-full min-h-[400px] w-full rounded-b-2xl bg-[radial-gradient(circle_at_top,rgba(124,124,255,0.08),transparent_36%),linear-gradient(180deg,rgba(17,24,39,0.35),rgba(17,24,39,0.1))]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'animated', animated: true }}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        attributionPosition="bottom-left"
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
      >
        <Background gap={18} color="rgba(148, 163, 184, 0.16)" />
        <Controls className="!rounded-xl !border !border-border/60 !bg-card/90 !text-foreground !shadow-xl !shadow-black/20" />
      </ReactFlow>
    </div>
  );
}

interface LayoutNode {
  id: string;
  title: string;
  status: string;
  assignedTo: string;
  icon: string;
  color: string;
  isRoot: boolean;
  metrics: { tokens: { total: number }; cost: number; durationMs: number };
  parentId?: string;
  x: number;
  y: number;
}

function buildDag(rootTask: Task, allTasks: Task[], familyColors: Record<string, string>, getTaskRootId: (id: string) => string): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const taskMap = new Map<string, Task>();
  taskMap.set(rootTask.id, rootTask);
  for (const t of allTasks) taskMap.set(t.id, t);

  // Agent mappings come from kanban store but buildDag is called inside useMemo
  // Use hardcoded fallback mappings since we can't call hooks inside useMemo
  const AGENT_COLORS: Record<string, string> = {
    manager: '#f59e0b', produto: '#a78bfa', generic: '#94a3b8',
    architecture: '#f472b6', engineer: '#60a5fa', 'code-reviewer': '#2dd4bf', qa: '#fb923c',
  };
  const AGENT_ICONS: Record<string, string> = {
    manager: 'ClipboardList', produto: 'Puzzle', generic: 'Bot',
    architecture: 'Building2', engineer: 'Code', 'code-reviewer': 'SearchCode', qa: 'FlaskConical',
  };

  // Compute subtree sizes for layout
  const subtreeSize = new Map<string, number>();
  function computeSize(taskId: string): number {
    if (subtreeSize.has(taskId)) return subtreeSize.get(taskId)!;
    const task = taskMap.get(taskId);
    if (!task) return 1;
    let size = 1;
    for (const subId of task.subtaskIds) {
      size += computeSize(subId);
    }
    subtreeSize.set(taskId, size);
    return size;
  }
  computeSize(rootTask.id);

  const H_SPACING = 320;
  const V_SPACING = 180;

  const collectTree = (task: Task, depth: number, xOffset: number, parentId?: string): LayoutNode[] => {
    const result: LayoutNode[] = [];
    const mySize = subtreeSize.get(task.id) ?? 1;
    const myX = xOffset + (mySize - 1) * H_SPACING / 2;

    result.push({
      id: task.id,
      title: task.title,
      status: task.status,
      assignedTo: task.assignedTo,
      color: AGENT_COLORS[task.assignedTo] ?? '#94a3b8',
      icon: AGENT_ICONS[task.assignedTo] ?? 'Bot',
      isRoot: task.id === rootTask.id,
      metrics: task.metrics,
      x: myX,
      y: depth * V_SPACING,
      parentId: parentId,
    });

    let childOffset = xOffset;
    for (const subtaskId of task.subtaskIds) {
      const subtask = taskMap.get(subtaskId);
      if (subtask) {
        const children = collectTree(subtask, depth + 1, childOffset, task.id);
        childOffset += (subtreeSize.get(subtaskId) ?? 1) * H_SPACING;
        for (const child of children) {
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
        id: node.id,
        label: node.title,
        status: node.status as TaskStatus,
        agent: node.assignedTo,
        icon: node.icon,
        color: node.color,
        treeColor: familyColors[getTaskRootId(node.id)] ?? defaultTreeColor(getTaskRootId(node.id)),
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
          stroke: node.status === 'RUNNING' ? 'var(--color-status-running)' :
                  node.status === 'COMPLETED' ? 'var(--color-status-completed)' :
                  node.status === 'FAILED' ? 'var(--color-status-failed)' :
                  'var(--color-muted-foreground)',
          strokeWidth: 2,
        },
      } as Edge);
    }
  }

  return { nodes, edges };
}
