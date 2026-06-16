import { useCallback, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';

interface UseDragAndDropOptions {
  onMove?: (taskId: string, newAgent: string) => void;
}

const DROP_AGENT_MAP: Record<string, string> = {
  // Single columns
  'drop-inbox': 'inbox',
  'drop-manager': 'manager',
  'drop-done': 'done',
  // Multi columns: top/bottom pairs
  'drop-produto-generic-top': 'produto',
  'drop-produto-generic-bottom': 'generic',
  'drop-architecture-engineer-top': 'architecture',
  'drop-architecture-engineer-bottom': 'engineer',
  'drop-code-reviewer-qa-top': 'code-reviewer',
  'drop-code-reviewer-qa-bottom': 'qa',
};

function resolveDropTarget(overId: string): string | null {
  return DROP_AGENT_MAP[overId] ?? null;
}

export function useDragAndDrop({ onMove }: UseDragAndDropOptions = {}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const overId = String(over.id);
      if (overId.startsWith('drop-')) {
        const agentId = resolveDropTarget(overId);
        if (agentId) onMove?.(String(active.id), agentId);
      } else if (overId.startsWith('column-')) {
        const agentId = overId.replace('column-', '');
        onMove?.(String(active.id), agentId);
      } else {
        // over.id é uma task — extrai assignedTo do data
        const data = over.data.current as { type?: string; task?: { assignedTo: string } } | undefined;
        if (data?.type === 'task' && data?.task?.assignedTo) {
          onMove?.(String(active.id), data.task.assignedTo);
        }
      }
    },
    [onMove]
  );

  return { activeId, handleDragStart, handleDragEnd };
}
