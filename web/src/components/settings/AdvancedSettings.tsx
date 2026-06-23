import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';

export function AdvancedSettings() {
  const { advanced, fetchSettings, updateAdvanced } = useSettingsStore();
  const [advancedOpen, setAdvancedOpen] = useState(true);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const configs = [
    { key: 'maxConcurrency', label: 'Max Concurrency', value: advanced.maxConcurrency },
    { key: 'runTimeoutMs', label: 'Run Timeout (ms)', value: advanced.runTimeoutMs },
    { key: 'maxTaskDepth', label: 'Max Task Depth', value: advanced.maxTaskDepth },
    { key: 'maxSubtasks', label: 'Max Subtasks', value: advanced.maxSubtasks },
    { key: 'maxRetries', label: 'Max Retries', value: advanced.maxRetries },
    { key: 'maxTechnicalRetries', label: 'Max Technical Retries', value: advanced.maxTechnicalRetries },
    { key: 'maxTokensBudget', label: 'Max Tokens Budget', value: advanced.maxTokensBudget },
    { key: 'maxCostBudget', label: 'Max Cost Budget', value: advanced.maxCostBudget },
  ] as const;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Control plane</p>
        <h2 className="mt-1 text-lg font-semibold">Advanced</h2>
        <p className="text-sm text-muted-foreground/75">Configurações avançadas do orquestrador.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orchestrator Config</CardTitle>
          <CardDescription>Limites e parâmetros para execução do swarm.</CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDown className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')} />
              Parameters
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-3">
              {configs.map(config => (
                <div key={config.key}>
                  <Label className="text-xs">{config.label}</Label>
                  <Input
                    type="number"
                    value={config.value}
                    onChange={e => updateAdvanced({ [config.key]: Number(e.target.value) })}
                    className="mt-1 h-8 text-sm"
                  />
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}
