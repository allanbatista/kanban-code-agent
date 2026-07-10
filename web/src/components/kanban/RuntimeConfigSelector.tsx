import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';

const MODEL_ALIASES = [
  { value: 'fast', label: 'Fast' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'deep', label: 'Deep' },
];

const EFFORT_LEVELS = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
];

const AGENTS = [
  { value: 'pi', label: 'Pi' },
  { value: 'codex', label: 'Codex' },
];

interface RuntimeConfigSelectorProps {
  model: string;
  effort: string;
  agent?: string;
  onModelChange?: (model: string) => void;
  onEffortChange?: (effort: string) => void;
  onAgentChange?: (agent: string) => void;
}

export function RuntimeConfigSelector({ model, effort, agent = 'pi', onModelChange, onEffortChange, onAgentChange }: RuntimeConfigSelectorProps) {
  return (
    <div className="grid grid-cols-4 gap-2 rounded-2xl border border-border/60 bg-card/40 p-3 shadow-sm">
      <div className="flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/75">Provider</Label>
        <Select value="openrouter">
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter" className="text-xs">OpenRouter</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/75">Model</Label>
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_ALIASES.map(m => (
              <SelectItem key={m.value} value={m.value} className="text-xs">{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/75">Effort</Label>
        <Select value={effort} onValueChange={onEffortChange}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EFFORT_LEVELS.map(e => (
              <SelectItem key={e.value} value={e.value} className="text-xs">{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/75">Agent</Label>
        <Select value={agent} onValueChange={onAgentChange}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENTS.map(a => (
              <SelectItem key={a.value} value={a.value} className="text-xs">{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
