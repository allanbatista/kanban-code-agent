// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading } from '../loading';
import { LoadingDots } from '../loading';

describe('Loading', () => {
  it('renders default spinner with message', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText(/carregando/i)).toBeDefined();
  });

  it('renders custom message', () => {
    render(<Loading message="Processando..." />);
    expect(screen.getByText('Processando...')).toBeDefined();
  });

  it('renders fullscreen variant', () => {
    const { container } = render(<Loading fullScreen />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl?.parentElement?.className).toBeDefined();
    // div pai deve ter classes fixed + inset-0
    const parentHtml = statusEl?.parentElement?.outerHTML ?? '';
    expect(parentHtml).toContain('fixed');
    expect(parentHtml).toContain('inset-0');
  });

  it('renders inline variant by default', () => {
    render(<Loading />);
    const container = screen.getByRole('status').parentElement;
    expect(container?.className).not.toContain('fixed');
  });
});

describe('LoadingDots', () => {
  it('renders three dots', () => {
    render(<LoadingDots />);
    const dots = screen.getByRole('status').querySelectorAll('span');
    expect(dots.length).toBe(3);
  });

  it('applies custom className', () => {
    render(<LoadingDots className="custom-class" />);
    expect(screen.getByRole('status').className).toContain('custom-class');
  });
});
