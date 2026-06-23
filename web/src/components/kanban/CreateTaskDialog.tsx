import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKanbanStore } from '@/stores/kanbanStore';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTaskDialog({ open, onOpenChange }: CreateTaskDialogProps) {
  const [message, setMessage] = useState('');
  const [model, setModel] = useState('balanced');
  const [effort, setEffort] = useState('medium');
  const [submitting, setSubmitting] = useState(false);
  const { createTask } = useKanbanStore();

  const handleCreate = async (execute: boolean) => {
    const text = message.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    // Optimistic: close immediately; the store already shows the card.
    onOpenChange(false);
    setMessage('');
    try {
      await createTask({ message: text, runtimeConfig: { model, effort }, execute });
    } catch {
      // Rollback + error are surfaced by the store; reopen so the user can retry.
      setMessage(text);
      onOpenChange(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova Tarefa</DialogTitle>
          <DialogDescription>Descreva o que precisa ser feito. Um título é gerado automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="message">Mensagem</Label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Descreva a tarefa..."
              rows={5}
              autoFocus
              className="mt-1 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <Label>Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="deep">Deep</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Effort</Label>
            <Select value={effort} onValueChange={setEffort}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="xhigh">X-High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="secondary" onClick={() => handleCreate(false)} disabled={!message.trim() || submitting}>Criar</Button>
          <Button onClick={() => handleCreate(true)} disabled={!message.trim() || submitting}>Criar e executar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
