import { useCallback, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';

interface UseDragAndDropOptions {
  onMove?: (taskId: string, newAgent: string) => void;
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
      if (overId.startsWith('column-')) {
        const agentId = overId.replace('column-', '');
        onMove?.(String(active.id), agentId);
      }
    },
    [onMove]
  );

  return { activeId, handleDragStart, handleDragEnd };
}
