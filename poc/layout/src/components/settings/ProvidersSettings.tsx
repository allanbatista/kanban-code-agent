import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Eye, EyeOff, Plus } from 'lucide-react';
import { MOCK_PROVIDERS } from '@/mocks/mockProviders';

export function ProvidersSettings() {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');

  const statusBadge = (status: string) => {
    if (status === 'connected') {
      return <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300">connected</Badge>;
    }
    return <Badge variant="outline" className="border-border/60 bg-background/50 text-muted-foreground">not configured</Badge>;
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Integrations</p>
          <h2 className="mt-1 text-lg font-semibold">Providers</h2>
          <p className="text-sm text-muted-foreground/75">Gerencie seus providers de IA.</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => setCustomDialogOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Custom
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60">
            {MOCK_PROVIDERS.map(provider => (
              <div key={provider.id} className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground/75">{provider.defaultModel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {statusBadge(provider.status)}
                  {provider.apiKeyConfigured ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type={showKeys[provider.id] ? 'text' : 'password'}
                        value="sk-...configured"
                        readOnly
                        className="h-7 w-32 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      >
                        {showKeys[provider.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 text-xs">Configurar</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Custom Provider</DialogTitle>
            <DialogDescription>Adicione um provider customizado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Meu Provider" className="mt-1" />
            </div>
            <div>
              <Label>Base URL</Label>
              <Input value={customUrl} onChange={e => setCustomUrl(e.target.value)} placeholder="https://api.exemplo.com" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => setCustomDialogOpen(false)}>Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
