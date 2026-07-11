import { useDroppable, useDndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { forwardRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { Settings2, Archive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskCard } from './TaskCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { AgentConfigDialog } from './AgentConfigDialog';
import { cn } from '@/lib/utils';
import type { Task, Agent } from '@/types/task';

interface AgentColumnProps {
  id: string;
  name: string;
  icon: string;
  color: string;
  tasks: Task[];
  isMulti?: boolean;
  subAgentName?: string;
  subAgentColor?: string;
  subAgentTasks?: Task[];
  onArchive?: () => void;
}

function ColumnHeader({ name, icon, color, tasks, onConfig, onArchive }: { name: string; icon: string; color: string; tasks: Task[]; onConfig?: () => void; onArchive?: () => void }) {
  const IconComponent = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>>)[icon] ?? LucideIcons.Bot;
  const runningCount = tasks.filter(t => t.status === 'RUNNING').length;

  return (
    <div className="group/header flex items-center justify-between border-b border-border/50 px-4 py-4 shrink-0 bg-black/10">
      <div className="flex items-center gap-2">
        <IconComponent className="h-4 w-4" style={{ color }} />
        <span className="text-sm font-medium">{name}</span>
        {onConfig && (
          <button
            onClick={(e) => { e.stopPropagation(); onConfig(); }}
            className="ml-1 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-white/5 hover:text-muted-foreground group-hover/header:opacity-100"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="ml-1 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:bg-white/5 hover:text-muted-foreground group-hover/header:opacity-100"
          >
            <Archive className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <Badge
        variant="outline"
        className={cn(
          'text-xs border-border/60 bg-background/50',
          runningCount > 0 ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' : 'text-muted-foreground'
        )}
      >
        {runningCount}/{tasks.length}
      </Badge>
    </div>
  );
}

function ColumnBody({ taskIds, isOver, children }: { taskIds: string[]; isOver: boolean; children: React.ReactNode }) {
  return (
    <ScrollArea className={cn('min-h-0 flex-1 px-2 transition-colors', isOver && 'bg-primary/5')}>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 p-2 py-4">
          {children}
        </div>
      </SortableContext>
    </ScrollArea>
  );
}

interface AgentPanelProps {
  droppableId: string;
  name: string;
  icon: string;
  color: string;
  tasks: Task[];
  className?: string;
  onConfig?: () => void;
  onArchive?: () => void;
}

const AgentPanel = forwardRef<HTMLDivElement, AgentPanelProps>(function AgentPanel(
  { droppableId, name, icon, color, tasks, className, onConfig, onArchive },
  _ref
) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const { active } = useDndContext();

  // Coluna de origem: painel que já contém a task arrastada. Não abrimos o
  // overlay na origem — soltar de volta no mesmo agente não é um movimento.
  const isSource = active != null && tasks.some(t => t.id === String(active.id));
  const showDropZone = active != null && !isSource;

  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 shadow-xl shadow-black/20 backdrop-blur-sm', className)}
    >
      <ColumnHeader name={name} icon={icon} color={color} tasks={tasks} onConfig={onConfig} onArchive={onArchive} />
      {/* Enquanto o overlay está ativo ele passa a ser o droppable da coluna,
          por isso o corpo só recebe o setNodeRef quando não há área reservada. */}
      <div ref={showDropZone ? undefined : setNodeRef} className="min-h-0 flex-1 flex flex-col overflow-hidden">
        <ColumnBody taskIds={tasks.map(t => t.id)} isOver={!showDropZone && isOver}>
          {tasks.length === 0 ? (
            <EmptyState title="Sem tasks" className="py-6" />
          ) : (
            tasks.map(task => <TaskCard key={task.id} task={task} />)
          )}
        </ColumnBody>
      </div>
      {showDropZone && (
        // Área de drop reservada: cobre praticamente a coluna inteira, deixando
        // apenas 15px de margem em todos os lados. pointer-events-none garante
        // que o div nunca intercepte cliques — o dnd-kit mede o rect direto.
        <div
          ref={setNodeRef}
          className={cn(
            'pointer-events-none absolute inset-[15px] z-20 flex items-center justify-center rounded-xl border-2 border-dashed transition-colors',
            isOver ? 'border-primary bg-primary/20' : 'border-primary/40 bg-primary/10'
          )}
        >
          <span className={cn('text-xs font-medium transition-colors', isOver ? 'text-primary' : 'text-primary/60')}>
            Soltar aqui
          </span>
        </div>
      )}
    </div>
  );
});
AgentPanel.displayName = 'AgentPanel';

export function AgentColumn({ id, name, icon, color, tasks, isMulti, subAgentName, subAgentColor, subAgentTasks, onArchive }: AgentColumnProps) {
  const [configAgent, setConfigAgent] = useState<Agent | null>(null);

  if (isMulti && subAgentName !== undefined && subAgentTasks !== undefined) {
    return (
      <div
        style={{ height: '100%' }}
        className="flex h-full min-h-0 min-w-[280px] flex-1 flex-col gap-4 rounded-2xl"
      >
        <AgentPanel
          droppableId={`drop-${id}-top`}
          name={name}
          icon={icon}
          color={color}
          tasks={tasks}
          className="flex-1"
          onConfig={() => setConfigAgent({ id: `${id}-top`, name, icon, color })}
        />
        <AgentPanel
          droppableId={`drop-${id}-bottom`}
          name={subAgentName}
          icon="Bot"
          color={subAgentColor ?? color}
          tasks={subAgentTasks}
          className="flex-1"
          onConfig={() => setConfigAgent({ id: `${id}-bottom`, name: subAgentName, icon: 'Bot', color: subAgentColor ?? color })}
        />
        {configAgent && (
          <AgentConfigDialog
            agent={configAgent}
            open={!!configAgent}
            onOpenChange={(open) => { if (!open) setConfigAgent(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <AgentPanel
        droppableId={`drop-${id}`}
        name={name}
        icon={icon}
        color={color}
        tasks={tasks}
        className="h-full min-w-[280px]"
        onConfig={() => setConfigAgent({ id, name, icon, color })}
        onArchive={onArchive}
      />
      {configAgent && (
        <AgentConfigDialog
          agent={configAgent}
          open={!!configAgent}
          onOpenChange={(open) => { if (!open) setConfigAgent(null); }}
        />
      )}
    </>
  );
}
