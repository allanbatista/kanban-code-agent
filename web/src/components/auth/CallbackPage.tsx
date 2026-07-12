import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loading } from '@/components/ui/loading';
import { useAuthStore } from '@/stores/authStore';

export function CallbackPage() {
  const [searchParams] = useSearchParams();
  const handleCallback = useAuthStore((s) => s.handleCallback);
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const token = searchParams.get('token');
    if (!token) {
      window.location.href = '/login?error=' + encodeURIComponent('Token de autenticação não recebido');
      return;
    }

    handleCallback(token);
  }, [searchParams, handleCallback]);

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
      <Loading message="Autenticando..." />
    </div>
  );
}
