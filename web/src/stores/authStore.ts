import { create } from 'zustand';
import { api } from '@/api/client';
import type { ApiUserProfile } from '@/types/api';

const AUTH_TOKEN_KEY = 'swarm_auth_token';

interface AuthState {
  user: ApiUserProfile | null;
  token: string | null;
  loading: boolean;
  login: (provider: string) => void;
  handleCallback: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem(AUTH_TOKEN_KEY),
  loading: false,

  login: (provider: string) => {
    const url = api.authLogin(provider);
    window.location.href = url;
  },

  handleCallback: async (token: string) => {
    set({ loading: true });
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      set({ token });
      const user = await api.authMe();
      set({ user, loading: false });
      window.location.href = '/';
    } catch (err) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      set({ token: null, user: null, loading: false });
      window.location.href = '/login?error=' + encodeURIComponent(
        err instanceof Error ? err.message : 'Falha na autenticação'
      );
    }
  },

  logout: async () => {
    try {
      await api.authLogout();
    } catch {
      // Ignore errors on logout — clear local state regardless
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    set({ user: null, token: null });
  },

  checkSession: async () => {
    const storedToken = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!storedToken) {
      set({ user: null, token: null });
      return;
    }
    set({ loading: true, token: storedToken });
    try {
      const user = await api.authMe();
      set({ user, loading: false });
    } catch {
      // 401 or network error — clear session
      localStorage.removeItem(AUTH_TOKEN_KEY);
      set({ user: null, token: null, loading: false });
    }
  },
}));
