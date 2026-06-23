import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/task';

interface TaskChatPanelProps {
  task: Task;
}

export function TaskChatPanel({ task }: TaskChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [task.chat.length]);

  return (
    <ScrollArea className="h-full p-4">
      <div ref={scrollRef} className="space-y-3">
        {task.chat.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border/60 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground/70">
            Nenhuma mensagem ainda.
          </p>
        )}
        {task.chat.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              msg.role === 'user' ? 'justify-end' : 'justify-start',
              msg.role === 'event' && 'justify-center'
            )}
          >
            {msg.role !== 'user' && msg.role !== 'event' && (
              <Avatar className="mt-1 h-6 w-6">
                <AvatarFallback className="bg-primary/15 text-[10px] font-semibold text-primary">AI</AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                'max-w-[82%] rounded-2xl border px-3 py-2 text-sm shadow-sm backdrop-blur-sm',
                msg.role === 'user' && 'border-primary/20 bg-primary/10 text-foreground',
                msg.role === 'assistant' && 'border-border/60 bg-secondary/70 text-foreground',
                msg.role === 'event' && 'border-border/50 bg-muted/60 text-center text-xs text-muted-foreground/80'
              )}
            >
              {msg.type === 'event' && <span className="italic">{msg.text}</span>}
              {msg.type === 'artifact' && (
                <div className="flex items-center gap-1 text-primary">
                  <span>📦</span>
                  <span>{msg.text}</span>
                </div>
              )}
              {msg.type === 'text' && <p className="whitespace-pre-wrap">{msg.text}</p>}
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
        ))}
      </div>
    </ScrollArea>
  );
}
