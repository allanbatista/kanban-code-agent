import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import type { ApiCodexStatus, ApiCodexDeviceLogin } from '@/types/api';

// Bloco de auth compartilhada do Codex (login uma vez, todos os runs reusam).
// Conectar via API key (input) ou device code (botão -> exibe URL+código e faz
// polling de status até completar). Desconectar remove o auth.json.
export function CodexSettings() {
  const [status, setStatus] = useState<ApiCodexStatus>({ loggedIn: false });
  const [apiKey, setApiKey] = useState('');
  const [device, setDevice] = useState<ApiCodexDeviceLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      setStatus(await api.getCodexStatus());
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleApiKeyLogin = async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.codexLogin({ method: 'apiKey', apiKey: apiKey.trim() });
      setApiKey('');
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDeviceLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.codexLogin({ method: 'deviceCode' });
      if (res.loginId && res.verificationUrl && res.userCode) {
        setDevice({ loginId: res.loginId, verificationUrl: res.verificationUrl, userCode: res.userCode });
        // Polling até o login completar (auth.json aparece).
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          const s = await api.getCodexStatus();
          setStatus(s);
          if (s.loggedIn && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setDevice(null);
          }
        }, 2500);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError(null);
    try {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setDevice(null);
      await api.codexLogout();
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Codex</p>
            <p className="text-xs text-muted-foreground/75">
              Login compartilhado do Codex — feito uma vez, reutilizado por todos os runs.
            </p>
          </div>
          {status.loggedIn ? (
            <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
              conectado{status.method ? ` (${status.method})` : ''}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-border/60 bg-background/50 text-muted-foreground">
              não conectado
            </Badge>
          )}
        </div>

        {status.loggedIn ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground/75">
              {status.email ?? 'Autenticado'}{status.plan ? ` · ${status.plan}` : ''}
            </p>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={busy}>
              Desconectar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-... (API key)"
                className="h-8 text-xs"
              />
              <Button size="sm" onClick={handleApiKeyLogin} disabled={busy || !apiKey.trim()}>
                Conectar
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDeviceLogin} disabled={busy}>
                Conectar via device code
              </Button>
              {device && (
                <p className="text-xs text-muted-foreground/80">
                  Abra{' '}
                  <a href={device.verificationUrl} target="_blank" rel="noreferrer" className="underline">
                    {device.verificationUrl}
                  </a>{' '}
                  e informe o código <span className="font-mono font-semibold">{device.userCode}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
