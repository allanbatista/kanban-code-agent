import { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MOCK_PROVIDERS, EFFORT_LEVELS, MODEL_ALIASES } from '@/mocks/mockProviders';
import { MarkdownField } from './MarkdownField';
import type { Agent } from '@/types/task';
type IconDict = Record<string, React.ComponentType<{ className?: string }>>;

interface AgentConfigDialogProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentConfigDialog({ agent, open, onOpenChange }: AgentConfigDialogProps) {
  const [provider, setProvider] = useState(MOCK_PROVIDERS[0]?.id ?? '');
  const [model, setModel] = useState('balanced');
  const [effort, setEffort] = useState('medium');
  const [systemPrompt, setSystemPrompt] = useState('');

  const IconComponent = (LucideIcons as unknown as IconDict)[agent.icon] ?? LucideIcons.Bot;

  const handleSave = () => {
    // TODO: persist config
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1080px] max-h-[90vh] h-full flex flex-col">
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <IconComponent className="h-5 w-5" style={{ color: agent.color }} />
          <span className="text-lg font-semibold">{agent.name}</span>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {MOCK_PROVIDERS.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {MODEL_ALIASES.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Select value={effort} onValueChange={setEffort}>
              <SelectTrigger>
                <SelectValue placeholder="Effort" />
              </SelectTrigger>
              <SelectContent>
                {EFFORT_LEVELS.map(e => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <MarkdownField value={systemPrompt} onChange={setSystemPrompt} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
