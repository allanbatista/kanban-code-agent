// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import { AgentColumn } from '../AgentColumn';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useKanbanStore } from '@/stores/kanbanStore';
import type { Task } from '@/types/task';

// Estado de arraste mutável controlado por teste.
let mockActive: { id: string } | null = null;
let mockIsOver = false;

vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: mockIsOver })),
  useDndContext: vi.fn(() => ({ active: mockActive })),
}));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: null, transition: null, isDragging: false,
  })),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }));

function makeTask(id: string, assignedTo: string): Task {
  return {
    id, title: `Task ${id}`, assignedTo, status: 'PENDING',
    subtaskIds: [], metrics: { startedAt: '', durationMs: 0 },
  } as unknown as Task;
}

describe('AgentColumn drop overlay', () => {
  beforeEach(() => {
    mockActive = null;
    mockIsOver = false;
    useKanbanStore.setState({
      tasks: [], familyColors: {},
      getTaskRootId: (id: string) => id,
    } as never);
  });

  it('não mostra overlay quando não há arraste ativo', () => {
    render(<AgentColumn id="review" name="Revisão" icon="Eye" color="#a78bfa" tasks={[makeTask('t1', 'review')]} />);
    expect(screen.queryByText('Soltar aqui')).toBeNull();
  });

  it('mostra a área de drop reservada em colunas permitidas durante o arraste', () => {
    mockActive = { id: 't1' }; // task arrastada mora em outra coluna
    render(<AgentColumn id="review" name="Revisão" icon="Eye" color="#a78bfa" tasks={[makeTask('t2', 'review')]} />);
    expect(screen.getByText('Soltar aqui')).toBeDefined();
  });

  it('não abre overlay na coluna de origem da task arrastada', () => {
    mockActive = { id: 't2' }; // task arrastada já pertence a esta coluna
    render(<AgentColumn id="review" name="Revisão" icon="Eye" color="#a78bfa" tasks={[makeTask('t2', 'review')]} />);
    expect(screen.queryByText('Soltar aqui')).toBeNull();
  });

  // Regressão de flicker: o nó de drop deve permanecer montado em todos os
  // estados (ocioso, origem e alvo). Ele é o droppable estável do dnd-kit —
  // se sumisse/remontasse ao alternar isSource durante o arraste, o dnd-kit
  // re-mediria a cada atualização e a tela piscaria. Apenas o texto "Soltar
  // aqui" (puramente visual) é condicional.
  it('mantém o nó de drop montado quando ocioso (nó estável, sem flicker)', () => {
    const { container } = render(<AgentColumn id="review" name="Revisão" icon="Eye" color="#a78bfa" tasks={[makeTask('t1', 'review')]} />);
    expect(container.querySelector('[data-dropzone]')).not.toBeNull();
    expect(screen.queryByText('Soltar aqui')).toBeNull();
  });

  it('mantém o nó de drop montado na coluna de origem durante o arraste', () => {
    mockActive = { id: 't2' }; // origem: task arrastada mora nesta coluna
    const { container } = render(<AgentColumn id="review" name="Revisão" icon="Eye" color="#a78bfa" tasks={[makeTask('t2', 'review')]} />);
    // nó presente e estável, mas oculto (aria-hidden) e sem o texto reservado
    const dropzone = container.querySelector('[data-dropzone]');
    expect(dropzone).not.toBeNull();
    expect(dropzone?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('Soltar aqui')).toBeNull();
  });
});

describe('useDragAndDrop drop resolution', () => {
  it('mapeia um drop sobre a área da coluna para o move handler', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useDragAndDrop({ onMove }));
    act(() => {
      result.current.handleDragEnd({
        active: { id: 't1' },
        over: { id: 'drop-review' },
      } as unknown as DragEndEvent);
    });
    expect(onMove).toHaveBeenCalledWith('t1', 'review');
  });
});
