import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Task, ChatMessage } from '@/types/task';

interface TaskHistoryPanelProps {
  task: Task;
}

export function TaskHistoryPanel({ task }: TaskHistoryPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.chat.length]);

  const allEntries = buildHistoryEntries(task);

  return (
    <ScrollArea className="h-full">
      <div ref={scrollRef} className="p-3 font-mono text-xs">
        {allEntries.length === 0 && (
          <div className="flex h-32 items-center justify-center text-muted-foreground/60">
            Nenhum evento registrado.
          </div>
        )}
        {allEntries.map((entry, i) => (
          <HistoryEntry key={i} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}

interface HistoryEntry {
  ts: string;
  type: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'event';
  text: string;
  detail?: string;
}

function buildHistoryEntries(task: Task): HistoryEntry[] {
  const entries: HistoryEntry[] = [];

  for (const run of task.runs) {
    entries.push({
      ts: run.startedAt ?? '',
      type: 'system',
      text: `▶ RUN ${run.runId}  status=${run.status}`,
      detail: run.error ? `error: ${run.error}` : run.completedAt ? `completed=${run.completedAt}` : '',
    });
    if (run.waitGroups.length > 0) {
      for (const wg of run.waitGroups) {
        entries.push({
          ts: run.startedAt ?? '',
          type: 'system',
          text: `  ⏳ WAIT ${wg.waitId}  mode=${wg.mode}  status=${wg.status}`,
          detail: wg.taskIds.length > 0 ? `waiting for: ${wg.taskIds.join(', ')}` : '',
        });
      }
    }
  }

  for (const msg of task.chat) {
    entries.push(chatToEntry(msg));
  }

  entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return entries;
}

function chatToEntry(msg: ChatMessage): HistoryEntry {
  if (msg.type === 'event') {
    return { ts: msg.ts, type: 'event', text: msg.text ?? '' };
  }
  if (msg.type === 'artifact') {
    const art = msg.artifacts?.[0];
    return {
      ts: msg.ts,
      type: 'tool_result',
      text: `📦 ARTIFACT: ${art?.path ?? 'unknown'}`,
      detail: `${art?.file_type ?? ''}  ${art?.sizeBytes ?? 0} bytes`,
    };
  }
  return {
    ts: msg.ts,
    type: msg.role === 'user' ? 'user' : 'assistant',
    text: msg.text ?? '',
  };
}

function HistoryEntry({ entry }: { entry: HistoryEntry }) {
  const colorClass = {
    system: 'text-amber-400/80',
    user: 'text-cyan-300/90',
    assistant: 'text-green-300/80',
    tool_call: 'text-violet-300/80',
    tool_result: 'text-blue-300/80',
    event: 'text-yellow-300/70',
  }[entry.type];

  const prefix = {
    system: '●',
    user: '▸',
    assistant: '◂',
    tool_call: '⚙',
    tool_result: '↳',
    event: '◆',
  }[entry.type];

  const time = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '--:--:--';

  return (
    <div className={cn('group border-b border-border/20 py-1.5 leading-relaxed hover:bg-muted/20', colorClass)}>
      <div className="flex gap-2">
        <span className="shrink-0 w-14 text-right text-[10px] text-muted-foreground/50">{time}</span>
        <span className="shrink-0 w-4 text-center">{prefix}</span>
        <div className="min-w-0 flex-1">
          <span className="whitespace-pre-wrap break-words">{entry.text}</span>
          {entry.detail && (
            <span className="ml-2 text-[10px] opacity-60">{entry.detail}</span>
          )}
        </div>
      </div>
    </div>
  );
}
