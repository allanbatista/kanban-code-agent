import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './StatusBadge';
import { useKanbanStore } from '@/stores/kanbanStore';
import type { Task } from '@/types/task';
import type { TaskStatus } from './StatusBadge';

interface TaskSummaryPanelProps {
  task: Task;
}

interface SummaryRow {
  id: string;
  title: string;
  depth: number;
  status: TaskStatus;
  durationMs: number;
  waitingMs: number;
  tokensTotal: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCache: number;
  cost: number;
  isRoot: boolean;
  agent: string;
}

export function TaskSummaryPanel({ task }: TaskSummaryPanelProps) {
  const { tasks } = useKanbanStore();
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [titleSearch, setTitleSearch] = useState('');
  const [agentOpen, setAgentOpen] = useState(false);
  const agentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (agentRef.current && !agentRef.current.contains(e.target as Node)) {
        setAgentOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allRows = useMemo(() => collectSummaryRows(task, tasks), [task, tasks]);

  const agents = useMemo(() => {
    const set = new Set(allRows.map(r => r.agent));
    return Array.from(set).sort();
  }, [allRows]);

  const filteredRows = useMemo(() => {
    return allRows.filter(r => {
      if (agentFilter.length > 0 && !agentFilter.includes(r.agent)) return false;
      if (titleSearch && !r.title.toLowerCase().includes(titleSearch.toLowerCase())) return false;
      return true;
    });
  }, [allRows, agentFilter, titleSearch]);

  const totals = useMemo(() => {
    let t = { tokensTotal: 0, tokensInput: 0, tokensOutput: 0, tokensCache: 0, cost: 0, durationMs: 0, waitingMs: 0 };
    for (const r of filteredRows) {
      t.tokensTotal += r.tokensTotal;
      t.tokensInput += r.tokensInput;
      t.tokensOutput += r.tokensOutput;
      t.tokensCache += r.tokensCache;
      t.cost += r.cost;
      t.durationMs += r.durationMs;
      t.waitingMs += r.waitingMs;
    }
    return t;
  }, [filteredRows]);

  const toggleAgent = (agent: string) => {
    setAgentFilter(prev =>
      prev.includes(agent) ? prev.filter(a => a !== agent) : [...prev, agent]
    );
  };

  const clearFilters = () => {
    setAgentFilter([]);
    setTitleSearch('');
  };

  const hasFilters = agentFilter.length > 0 || titleSearch.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Filtrar por título..."
            value={titleSearch}
            onChange={e => setTitleSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div ref={agentRef} className="relative">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={() => setAgentOpen(o => !o)}
          >
            Agentes
            {agentFilter.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0 text-[10px]">{agentFilter.length}</span>
            )}
            <ChevronDown className="h-3 w-3" />
          </Button>
          {agentOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-md border border-border/60 bg-card/85 backdrop-blur-sm shadow-lg">
              <div className="max-h-48 overflow-auto p-1">
                {agents.map(agent => (
                  <button
                    key={agent}
                    onClick={() => toggleAgent(agent)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40 transition-colors"
                  >
                    <span className={`h-3 w-3 rounded border ${agentFilter.includes(agent) ? 'bg-primary border-primary' : 'border-border/60'}`} />
                    <span>{agent}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground gap-1" onClick={clearFilters}>
            <X className="h-3 w-3" />
            Limpar
          </Button>
        )}

        <span className="ml-auto text-[10px] text-muted-foreground/60">
          {filteredRows.length} de {allRows.length} tasks
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-3 pt-2">
        <div className="overflow-x-auto rounded-lg border border-border/40">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-card/95 backdrop-blur-sm text-left text-muted-foreground/80 shadow-[0_1px_0_0_var(--color-border)]">
                <th className="py-2 pl-3 pr-2 font-medium w-full">Título</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-center">Depth</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap">Status</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Tempo</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Espera</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Tokens</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Input</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Output</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Cache</th>
                <th className="px-2 py-2 font-medium w-px whitespace-nowrap text-right">Custo</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-muted-foreground/50">
                    Nenhuma task encontrada com os filtros atuais.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-border/20 hover:bg-muted/20 transition-colors"
                  >
                    <td className="py-1.5 pl-3 pr-2 w-full">
                      <span className="font-medium" style={{ paddingLeft: row.depth * 16 }}>
                        {row.isRoot ? '◆ ' : '↳ '}
                        {row.title}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center text-muted-foreground/70 whitespace-nowrap">{row.depth}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground/80 whitespace-nowrap">{formatMs(row.durationMs)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-amber-400/80 whitespace-nowrap">{row.waitingMs > 0 ? formatMs(row.waitingMs) : '-'}</td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{row.tokensTotal.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground/70 whitespace-nowrap">{row.tokensInput.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground/70 whitespace-nowrap">{row.tokensOutput.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-violet-300/70 whitespace-nowrap">{row.tokensCache.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{row.cost < 0.01 ? `< $0.01` : `$${row.cost.toFixed(4)}`}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="sticky bottom-0 z-10">
              <tr className="border-t-2 border-border/40 bg-card/95 backdrop-blur-sm font-semibold shadow-[0_-1px_0_0_var(--color-border)]">
                <td className="py-2 pl-3 pr-2">Total ({filteredRows.length} tasks)</td>
                <td className="px-2 py-2 text-center whitespace-nowrap">-</td>
                <td className="px-2 py-2 whitespace-nowrap">-</td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{formatMs(totals.durationMs)}</td>
                <td className="px-2 py-2 text-right font-mono text-amber-400/80 whitespace-nowrap">{totals.waitingMs > 0 ? formatMs(totals.waitingMs) : '-'}</td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{totals.tokensTotal.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{totals.tokensInput.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{totals.tokensOutput.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono text-violet-300/70 whitespace-nowrap">{totals.tokensCache.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono whitespace-nowrap">${totals.cost.toFixed(4)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function collectSummaryRows(root: Task, allTasks: Task[]): SummaryRow[] {
  const taskMap = new Map<string, Task>();
  for (const t of allTasks) taskMap.set(t.id, t);

  const result: SummaryRow[] = [];
  const visited = new Set<string>();

  function walk(task: Task, depth: number) {
    if (visited.has(task.id)) return;
    visited.add(task.id);

    result.push({
      id: task.id,
      title: task.title,
      depth,
      status: task.status as TaskStatus,
      durationMs: task.metrics.durationMs,
      waitingMs: task.metrics.waitingMs,
      tokensTotal: task.metrics.tokens.total,
      tokensInput: task.metrics.tokens.input,
      tokensOutput: task.metrics.tokens.output,
      tokensCache: task.metrics.tokens.cache,
      cost: task.metrics.cost,
      isRoot: task.id === root.id,
      agent: task.assignedTo,
    });

    for (const subId of task.subtaskIds) {
      const sub = taskMap.get(subId);
      if (sub) walk(sub, depth + 1);
    }
  }

  walk(root, 0);
  return result;
}

function formatMs(ms: number): string {
  if (ms === 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
