// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../error-boundary';

const ThrowError = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('renders error fallback on error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowError message="Test error" />
      </ErrorBoundary>
    );
    expect(screen.getByText(/algo deu errado/i)).toBeDefined();
    expect(screen.getByText('Test error')).toBeDefined();
    vi.restoreAllMocks();
  });

  it('calls onError when error occurs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowError message="Callback test" />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
    vi.restoreAllMocks();
  });

  it('renders custom fallback when provided', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowError message="Custom" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom error UI')).toBeDefined();
    expect(() => screen.getByText(/algo deu errado/i)).toThrow();
    vi.restoreAllMocks();
  });

  it('allows retry after error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const GoodComponent = ({ shouldThrow }: { shouldThrow: boolean }) => {
      if (shouldThrow) throw new Error('Retry test');
      return <div>Success</div>;
    };

    render(
      <ErrorBoundary key="retry">
        <GoodComponent shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText(/algo deu errado/i)).toBeDefined();

    // Should show retry button
    const retryBtn = screen.getByRole('button', { name: /tentar novamente/i });
    expect(retryBtn).toBeDefined();

    vi.restoreAllMocks();
  });
});
