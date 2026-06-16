import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { MODEL_ALIASES, EFFORT_LEVELS } from '@/mocks/mockProviders';

interface RuntimeConfigSelectorProps {
  model: string;
  effort: string;
  onModelChange?: (model: string) => void;
  onEffortChange?: (effort: string) => void;
}

export function RuntimeConfigSelector({ model, effort, onModelChange, onEffortChange }: RuntimeConfigSelectorProps) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/60 bg-card/40 p-3 shadow-sm">
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
    </div>
  );
}
