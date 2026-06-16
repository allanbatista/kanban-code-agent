import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useKanbanStore } from '@/stores/kanbanStore';
import { AGENTS } from '@/mocks/mockAgents';
import type { TaskStatus } from '@/types/task';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateTaskDialog({ open, onOpenChange }: CreateTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [agent, setAgent] = useState('');
  const [model, setModel] = useState('balanced');
  const [effort, setEffort] = useState('medium');
  const { addTask, tasks } = useKanbanStore();

  const handleCreate = () => {
    if (!title.trim() || !agent) return;
    const newTask = {
      id: `task_${String(tasks.length + 1).padStart(3, '0')}`,
      title: title.trim(),
      assignedTo: agent,
      status: 'PENDING' as TaskStatus,
      depth: 0,
      subtaskIds: [],
      runtimeConfig: { model, effort },
      chat: [],
      artifacts: [],
      attachments: [],
      metrics: { durationMs: 0, tokens: { input: 0, output: 0, total: 0 }, cost: 0 },
      retryCount: 0,
      runs: [],
    };
    addTask(newTask);
    setTitle('');
    setAgent('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova Tarefa</DialogTitle>
          <DialogDescription>Crie uma nova tarefa para um agente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Descreva a tarefa..." className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="agent">Agente</Label>
            <Select value={agent} onValueChange={setAgent}>
              <SelectTrigger id="agent" className="mt-1">
                <SelectValue placeholder="Selecione um agente" />
              </SelectTrigger>
              <SelectContent>
                {AGENTS.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button onClick={handleCreate} disabled={!title.trim() || !agent}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
