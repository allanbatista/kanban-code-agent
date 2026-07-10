// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CodexSettings } from '../CodexSettings';

vi.mock('@/api/client', () => ({
  api: {
    getCodexStatus: vi.fn(),
    codexLogin: vi.fn(),
    codexLogout: vi.fn(),
  },
}));

import { api } from '@/api/client';

describe('CodexSettings (F1.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "não conectado" and connects via API key', async () => {
    (api.getCodexStatus as any)
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({ loggedIn: true, method: 'apiKey' });
    (api.codexLogin as any).mockResolvedValue({ ok: true });

    render(<CodexSettings />);
    expect(await screen.findByText('não conectado')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('sk-... (API key)'), { target: { value: 'sk-abc' } });
    fireEvent.click(screen.getByText('Conectar'));

    await waitFor(() => {
      expect(api.codexLogin).toHaveBeenCalledWith({ method: 'apiKey', apiKey: 'sk-abc' });
    });
    expect(await screen.findByText(/conectado/)).toBeDefined();
  });

  it('shows Desconectar when already logged in', async () => {
    (api.getCodexStatus as any).mockResolvedValue({ loggedIn: true, method: 'chatgpt', email: 'me@example.com' });
    render(<CodexSettings />);
    expect(await screen.findByText('Desconectar')).toBeDefined();
    expect(screen.getByText(/me@example.com/)).toBeDefined();
  });
});
