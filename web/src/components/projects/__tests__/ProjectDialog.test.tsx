// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectDialog } from '../ProjectDialog';
import { useProjectsStore } from '@/stores/projectsStore';

const mockCreateProject = vi.fn();
const mockUpdateProject = vi.fn();

describe('ProjectDialog error rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectsStore.setState({
      createProject: mockCreateProject,
      updateProject: mockUpdateProject,
    });
  });

  it('renders the API error inline and keeps the dialog open on create failure', async () => {
    mockCreateProject.mockRejectedValueOnce(new Error('gitUrl invalida: use http(s)://, ssh://, file:// ou git@host:caminho'));
    const onOpenChange = vi.fn();
    render(<ProjectDialog open={true} onOpenChange={onOpenChange} editProject={null} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Nome do projeto'), { target: { value: 'App' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(screen.getByText(/gitUrl invalida/)).toBeDefined());
    // Dialog permanece aberto: onOpenChange(false) nunca foi chamado.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes without error on success', async () => {
    mockCreateProject.mockResolvedValueOnce({ id: 'app' });
    const onOpenChange = vi.fn();
    render(<ProjectDialog open={true} onOpenChange={onOpenChange} editProject={null} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Nome do projeto'), { target: { value: 'App' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/invalida/)).toBeNull();
  });
});
