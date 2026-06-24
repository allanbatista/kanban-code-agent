import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useKanbanStore } from '@/stores/kanbanStore';
import { cn } from '@/lib/utils';
import type { Task } from '@/types/task';

interface TaskChatPanelProps {
  task: Task;
}

export function TaskChatPanel({ task }: TaskChatPanelProps) {
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
              {msg.type === 'text' && (
                <div className="prose prose-sm dark:prose-invert max-w-none break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                </div>
              )}
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
    <div className="flex items-center gap-2 border-t border-border/50 p-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        placeholder="Enviar mensagem..."
      />
      <Button size="icon" onClick={handleSend} disabled={!text.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </div>
    </div>
  );
}
