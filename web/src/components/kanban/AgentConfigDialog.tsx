import { useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MarkdownField } from './MarkdownField';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Agent } from '@/types/task';
type IconDict = Record<string, React.ComponentType<{ className?: string }>>;

const EFFORT_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
];

const MODEL_ALIASES = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'deep', label: 'Deep' },
];

const AGENTS = [
  { value: 'pi', label: 'Pi' },
  { value: 'codex', label: 'Codex' },
];

interface AgentConfigDialogProps {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentConfigDialog({ agent, open, onOpenChange }: AgentConfigDialogProps) {
  const { rawProviders, fetchSettings } = useSettingsStore();
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('balanced');
  const [effort, setEffort] = useState('medium');
  const [agentName, setAgentName] = useState('pi');
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (rawProviders.length > 0 && !provider) {
      setProvider(rawProviders[0]?.name ?? '');
    }
  }, [rawProviders, provider]);

  const IconComponent = (LucideIcons as unknown as IconDict)[agent.icon] ?? LucideIcons.Bot;

  const handleSave = () => {
    // TODO: persist config
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1080px] max-h-[90vh] h-full flex flex-col">
        <DialogHeader className="flex-row items-center gap-3 space-y-0">
          <span style={{ color: agent.color, display: 'inline-flex' }}><IconComponent className="h-5 w-5" /></span>
          <span className="text-lg font-semibold">{agent.name}</span>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {rawProviders.map(p => (
                  <SelectItem key={p.name} value={p.name}>{p.provider}</SelectItem>
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
          <div className="flex-1">
            <Select value={agentName} onValueChange={setAgentName}>
              <SelectTrigger>
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                {AGENTS.map(a => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
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
