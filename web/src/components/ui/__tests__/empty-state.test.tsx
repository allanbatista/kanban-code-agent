// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../empty-state';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="Nenhum resultado"
        description="Nenhum item encontrado."
      />
    );
    expect(screen.getByText('Nenhum resultado')).toBeDefined();
    expect(screen.getByText('Nenhum item encontrado.')).toBeDefined();
  });

  it('renders icon when provided', () => {
    render(
      <EmptyState
        title="Vazio"
        icon={<span data-testid="custom-icon">🔍</span>}
      />
    );
    expect(screen.getByTestId('custom-icon')).toBeDefined();
  });

  it('renders action button when provided', () => {
    const onAction = () => {};
    render(
      <EmptyState
        title="Vazio"
        action={{ label: 'Criar novo', onClick: onAction }}
      />
    );
    expect(screen.getByRole('button', { name: 'Criar novo' })).toBeDefined();
  });

  it('calls action onClick when clicked', () => {
    let clicked = false;
    render(
      <EmptyState
        title="Vazio"
        action={{ label: 'Criar', onClick: () => { clicked = true; } }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(clicked).toBe(true);
  });
});
