// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskDrawer } from '../TaskDrawer';
import { useKanbanStore } from '@/stores/kanbanStore';
import { MOCK_TASKS } from '@/mocks/mockTasks';

vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

vi.mock('react-dom', () => ({
  createPortal: (node: React.ReactNode) => node,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}));

// Mock child panels
vi.mock('../TaskChatPanel', () => ({
  TaskChatPanel: () => <div>Chat Panel</div>,
}));
vi.mock('../TaskHistoryPanel', () => ({
  TaskHistoryPanel: () => <div>History Panel</div>,
}));
vi.mock('../TaskSummaryPanel', () => ({
  TaskSummaryPanel: () => <div>Summary Panel</div>,
}));
vi.mock('@/components/workflow/WorkflowView', () => ({
  WorkflowView: () => <div>Workflow View</div>,
}));

describe('TaskDrawer (T07)', () => {
  beforeEach(() => {
    useKanbanStore.setState({
      tasks: MOCK_TASKS,
      familyColors: {},
      getTaskById: (id: string) => MOCK_TASKS.find(t => t.id === id),
      getTaskRootId: (id: string) => id,
      setTasks: vi.fn(),
      setFamilyColor: vi.fn(),
    });
  });

  it('renders "not found" for invalid taskId', () => {
    useKanbanStore.setState({
      getTaskById: () => undefined,
    });
    render(
      <TaskDrawer taskId="nonexistent" defaultTab="chat" onClose={vi.fn()} />
    );
    expect(screen.getByText(/não encontrada/i)).toBeDefined();
  });

  it('renders task title', () => {
    render(
      <TaskDrawer taskId="task_001" defaultTab="chat" onClose={vi.fn()} />
    );
    expect(screen.getByText(/implementar login/i)).toBeDefined();
  });

  it('renders status badge in footer', () => {
    render(
      <TaskDrawer taskId="task_001" defaultTab="chat" onClose={vi.fn()} />
    );
    expect(screen.getByText(/executando/i)).toBeDefined();
  });

  it('renders tab navigation', () => {
    const { container } = render(
      <TaskDrawer taskId="task_001" defaultTab="chat" onClose={vi.fn()} />
    );
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    expect(tabs[0]?.textContent).toMatch(/chat/i);
  });
});
