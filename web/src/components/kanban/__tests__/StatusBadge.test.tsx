// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
  it('renders the SUSPENDED state', () => {
    render(<StatusBadge status="SUSPENDED" />);
    expect(screen.getByText('Suspensa')).toBeDefined();
  });

  it('distinguishes WAITING(human) from WAITING(subtasks)', () => {
    const { rerender } = render(<StatusBadge status="WAITING" waitingReason="human" />);
    expect(screen.getByText('Aguardando humano')).toBeDefined();
    rerender(<StatusBadge status="WAITING" waitingReason="subtasks" />);
    expect(screen.getByText('Aguardando')).toBeDefined();
  });

  it('renders the failure reason on FAILED', () => {
    render(<StatusBadge status="FAILED" failureReason="ceiling" />);
    expect(screen.getByText('Falhou (teto excedido)')).toBeDefined();
  });

  it('renders the stagnation failure reason', () => {
    render(<StatusBadge status="FAILED" failureReason="stagnation" />);
    expect(screen.getByText('Falhou (estagnação)')).toBeDefined();
  });
});
