// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KanbanBoard } from '../KanbanBoard';
import { useKanbanStore } from '@/stores/kanbanStore';
import { MOCK_TASKS } from '@/mocks/mockTasks';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
  useNavigate: vi.fn(),
}));

// Mock hooks
vi.mock('@/hooks/useDragAndDrop', () => ({
  useDragAndDrop: vi.fn(() => ({
    activeId: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
  })),
}));

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false, active: null })),
  useDraggable: vi.fn(() => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false })),
}));

// Mock dnd-kit sortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>{children}</button>
  ),
}));

describe('KanbanBoard (T05)', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      tasks: MOCK_TASKS,
      agents: [],
      loading: false,
      error: null,
      fetchTasks: vi.fn(),
      fetchAgents: vi.fn(),
    });
  });

  it('renders loading state when loading and no tasks', () => {
    useKanbanStore.setState({ tasks: [], loading: true, error: null });
    render(<KanbanBoard />);
    expect(screen.getByText(/carregando/i)).toBeDefined();
  });

  it('renders error state', () => {
    useKanbanStore.setState({ tasks: [], loading: false, error: 'API Error' });
    const { container } = render(<KanbanBoard />);
    expect(container.textContent).toContain('Erro:');
    expect(container.textContent).toContain('API Error');
  });

  it('renders board container', () => {
    const { container } = render(<KanbanBoard />);
    expect(container.textContent).toContain('Implementar login');
  });
});
