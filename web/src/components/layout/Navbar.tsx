import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Workflow, Command, Keyboard } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useKanbanStore } from '@/stores/kanbanStore';

const NAV_ITEMS = [
  { path: '/', label: 'Kanban' },
  { path: '/projects', label: 'Projects' },
  { path: '/settings', label: 'Settings' },
];

export function Navbar() {
  const location = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);
  const tasks = useKanbanStore(s => s.tasks);
  const wsConnected = useKanbanStore(s => s.wsConnected);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-40 h-14 backdrop-blur-md bg-black/10 border-b border-border/50 shadow-sm">
        <div className="flex items-center h-full px-4 gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold text-foreground shrink-0">
            <Workflow className="h-5 w-5 text-primary" />
            <span>Workflow</span>
          </Link>

          <div className="flex items-center gap-1 ml-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-md transition-colors',
                  location.pathname === item.path
                    ? 'bg-secondary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="flex-1" />

          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title={wsConnected ? 'Tempo real conectado (WebSocket)' : 'Sem conexão em tempo real (WebSocket)'}
          >
            <span
              className={cn(
                'inline-block h-2 w-2 rounded-full',
                wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500',
              )}
            />
            <span className="hidden sm:inline">{wsConnected ? 'Tempo real' : 'Offline'}</span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground gap-2"
            onClick={() => setCommandOpen(true)}
          >
            <Command className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Cmd+K</span>
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              <Keyboard className="h-2.5 w-2.5" />K
            </kbd>
          </Button>

          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">U</AvatarFallback>
          </Avatar>
        </div>
      </nav>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Buscar tasks, projetos..." />
        <CommandList>
          <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>
          <CommandGroup heading="Tasks">
            {tasks.map((task) => (
              <CommandItem
                key={task.id}
                onSelect={() => {
                  setCommandOpen(false);
                  window.location.href = `/?task=${task.id}&tab=chat`;
                }}
              >
                <span className="text-xs text-muted-foreground mr-2">#{task.id.slice(0, 8)}</span>
                {task.title}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
