// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTaskDialog } from '../CreateTaskDialog';
import { useKanbanStore } from '@/stores/kanbanStore';
import { useProjectsStore } from '@/stores/projectsStore';

const mockCreateTask = vi.fn();
const mockFetchProjects = vi.fn();

const mockAgents = [
  { id: 'agent1', name: 'Agent 1', icon: 'Bot', color: '#000' },
  { id: 'agent2', name: 'Agent 2', icon: 'Code', color: '#fff' },
];

describe('CreateTaskDialog (T06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchProjects.mockResolvedValue(undefined);
    useKanbanStore.setState({
      agents: mockAgents,
      createTask: mockCreateTask,
    });
    useProjectsStore.setState({
      projects: [
        {
          id: 'app',
          slug: 'app',
          name: 'App',
          description: '',
          defaultBranch: 'main',
          autoMerge: false,
          location: '',
          taskCount: 0,
          runningCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      fetchProjects: mockFetchProjects,
    });
  });

  it('renders dialog title when open', () => {
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Nova Tarefa')).toBeDefined();
  });

  it('does not render when closed', () => {
    render(<CreateTaskDialog open={false} onOpenChange={vi.fn()} />);
    expect(() => screen.getByText('Nova Tarefa')).toThrow();
  });

  it('renders form fields', () => {
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Mensagem')).toBeDefined();
    expect(screen.getByText('Model')).toBeDefined();
    expect(screen.getByText('Effort')).toBeDefined();
  });

  it('renders Create, Create-and-run and Cancel buttons', () => {
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Criar' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Criar e executar' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDefined();
  });

  it('create buttons are disabled when message is empty', () => {
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Criar' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Criar e executar' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends message and execute flag on Criar e executar', async () => {
    mockCreateTask.mockResolvedValueOnce({ id: 't1' });
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Descreva a tarefa...'), { target: { value: 'fazer X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar e executar' }));
    await waitFor(() =>
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ message: 'fazer X', execute: true })),
    );
  });

  it('sends selected projectIds', async () => {
    mockCreateTask.mockResolvedValueOnce({ id: 't1' });
    render(<CreateTaskDialog open={true} onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Descreva a tarefa...'), { target: { value: 'fazer X' } });
    fireEvent.click(screen.getByLabelText('App'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(mockCreateTask).toHaveBeenCalledWith(expect.objectContaining({ projectIds: ['app'] })),
    );
  });

  it('calls onOpenChange(false) when cancel clicked', () => {
    const onOpenChange = vi.fn();
    render(<CreateTaskDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
