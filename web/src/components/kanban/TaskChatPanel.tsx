import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, ChevronDown, ChevronUp, ExternalLink, Paperclip, MessageCircleQuestion } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useKanbanStore } from '@/stores/kanbanStore';
import { cn } from '@/lib/utils';
import type { Task, ChatMessage } from '@/types/task';
import { ArtifactViewer } from './ArtifactViewer';

interface TaskChatPanelProps {
  task: Task;
  onOpenTask?: (taskId: string) => void;
}

// Last natural-language reply a task produced — shown when expanding an event line.
function lastAssistantText(task: Task): string | undefined {
  for (let i = task.chat.length - 1; i >= 0; i--) {
    const m = task.chat[i];
    if (m.role === 'assistant' && m.type === 'text' && m.text?.trim()) return m.text;
  }
  return undefined;
}

// A terminal-event line (e.g. "task task_32 concluída"): clickable to open the
// subtask chat, with a toggle to reveal that subtask's return message inline.
function EventMessage({ msg, onOpenTask }: { msg: ChatMessage; onOpenTask?: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  // Prefer the structural id; fall back to parsing it from the line for chats
  // recorded before refTaskId existed ("task task_32 concluída").
  const refTaskId = msg.refTaskId ?? msg.text?.match(/task_\d+/)?.[0];
  const subtask = useKanbanStore((s) => (refTaskId ? s.tasks.find((t) => t.id === refTaskId) : undefined));
  const returnText = subtask ? lastAssistantText(subtask) : undefined;
  const clickable = Boolean(refTaskId && onOpenTask);

  return (
    <div className="flex justify-center">
      <div className="max-w-[82%] rounded-2xl border border-border/50 bg-muted/60 px-3 py-2 text-xs text-muted-foreground/80">
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            disabled={!clickable}
            onClick={() => refTaskId && onOpenTask?.(refTaskId)}
            className={cn('inline-flex items-center gap-1 italic', clickable && 'cursor-pointer hover:text-foreground hover:underline')}
            title={clickable ? `Abrir chat de ${refTaskId}` : undefined}
          >
            {msg.text}
            {clickable && <ExternalLink className="h-3 w-3 opacity-60" />}
          </button>
          {returnText && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground/70 hover:bg-muted hover:text-foreground"
              title={open ? 'Ocultar retorno' : 'Ver retorno'}
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              retorno
            </button>
          )}
        </div>
        {open && returnText && (
          <div className="prose prose-sm dark:prose-invert mt-2 max-w-none break-words border-t border-border/40 pt-2 text-left text-foreground/90">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{returnText}</ReactMarkdown>
          </div>
        )}
        <span className="mt-1 block text-[10px] text-muted-foreground/60">
          {new Date(msg.ts).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

export function TaskChatPanel({ task, onOpenTask }: TaskChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.chat.length]);

  const handleSend = () => {
    const value = text.trim();
    if (!value) return;
    useKanbanStore.getState().sendMessage(task.id, value);
    setText('');
  };

  return (
    <div className="flex h-full flex-col">
    <ScrollArea className="flex-1 p-4">
      <div ref={scrollRef} className="space-y-3">
        {task.chat.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground/70">
            Nenhuma mensagem ainda.
          </p>
        )}
        {task.chat.map((msg, i) =>
          msg.role === 'event' ? (
            <EventMessage key={i} msg={msg} onOpenTask={onOpenTask} />
          ) : (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {msg.role !== 'user' && (
              <Avatar className="mt-1 h-6 w-6">
                <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">AI</AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                'max-w-[82%] rounded-2xl border px-3 py-2 text-sm shadow-sm backdrop-blur-sm',
                msg.role === 'user' && 'border-primary/20 bg-primary/10 text-foreground',
                msg.role === 'assistant' && 'border-border/60 bg-secondary/70 text-foreground'
              )}
            >
              {msg.type === 'artifact' && (
                <div className="text-primary">
                  <div className="flex items-center gap-1">
                    <span>📦</span>
                    <span>{msg.text}</span>
                  </div>
                </div>
              )}
              {msg.type === 'text' && (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                </div>
              )}
              {msg.artifacts?.map((a, ai) => (
                <ArtifactViewer key={`${a.path}-${ai}`} taskId={task.id} artifact={a} />
              ))}
              {/* Human attachments. */}
              {msg.attachments?.map((att, ai) => (
                <div key={ai} className="mt-1 flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-xs">
                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{att.originalName}</span>
                  <span className="text-[10px] text-muted-foreground/60">{Math.ceil(att.sizeBytes / 1024)} KB</span>
                </div>
              ))}
              <span className="mt-1 block text-[10px] text-muted-foreground/60">
                {new Date(msg.ts).toLocaleTimeString()}
              </span>
            </div>
            {msg.role === 'user' && (
              <Avatar className="mt-1 h-6 w-6">
                <AvatarFallback className="bg-blue-500/15 text-[10px] font-semibold text-blue-300">U</AvatarFallback>
              </Avatar>
            )}
          </div>
          )
        )}
      </div>
    </ScrollArea>
    {/* HITL: when the agent is waiting on the human, prompt the reply inline.
        The answer is sent through the normal chat composer (chat-only design). */}
    {task.status === 'WAITING' && task.waitingReason === 'human' && (
      <div className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
        <MessageCircleQuestion className="h-4 w-4 shrink-0" />
        <span>O agente aguarda sua resposta. Responda pelo campo abaixo.</span>
      </div>
    )}
    {task.status === 'SUSPENDED' && (
      <div className="flex items-center gap-2 border-t border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80">
        <MessageCircleQuestion className="h-4 w-4 shrink-0" />
        <span>Suspensa por timeout. Uma resposta reativa a tarefa.</span>
      </div>
    )}
    <div className="flex items-center gap-2 border-t border-border/50 p-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder={task.waitingReason === 'human' ? 'Responder ao agente...' : 'Enviar mensagem...'}
      />
      <Button size="icon" onClick={handleSend} disabled={!text.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </div>
    </div>
  );
}
