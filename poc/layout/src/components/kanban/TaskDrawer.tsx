import { useSearchParams } from 'react-router-dom';
import { X, MessageSquare, FileText, GitBranch } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { StatusDot, getStatusLabel } from '../kanban/StatusDot';
import { TaskChatPanel } from './TaskChatPanel';
import { TaskPromptPanel } from './TaskPromptPanel';
import { RuntimeConfigSelector } from './RuntimeConfigSelector';
import { WorkflowView } from '@/components/workflow/WorkflowView';
import { useKanbanStore } from '@/stores/kanbanStore';
import { cn } from '@/lib/utils';

interface TaskDrawerProps {
  taskId: string;
  defaultTab: 'chat' | 'prompt' | 'workflow';
  onClose: () => void;
}

export function TaskDrawer({ taskId, defaultTab, onClose }: TaskDrawerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks, getTaskById } = useKanbanStore();
  const task = getTaskById(taskId);

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('task', taskId);
    params.set('tab', tab);
    setSearchParams(params, { replace: true });
  };

  if (!task) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[480px] max-w-full border-l border-border/60 bg-card/95 pt-14 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <h2 className="text-sm font-medium">Task não encontrada</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-border/60 bg-card/95 pt-14 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <div className="flex items-start justify-between border-b border-border/50 bg-background/40 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="mr-1 text-muted-foreground transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
            <h2 className="truncate text-sm font-semibold">{task.title}</h2>
          </div>
          <div className="ml-6 mt-1 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{task.assignedTo}</span>
            <StatusDot status={task.status} />
            <span className={cn('text-xs text-muted-foreground/80', task.status === 'CANCELLED' && 'line-through')}>
              {getStatusLabel(task.status)}
            </span>
          </div>
        </div>
      </div>

      <Tabs
        defaultValue={defaultTab}
        onValueChange={handleTabChange}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="px-4 pt-3">
          <TabsList className="grid h-11 w-full grid-cols-3">
            <TabsTrigger value="chat" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Chat
            </TabsTrigger>
            <TabsTrigger value="prompt" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Prompt
            </TabsTrigger>
            <TabsTrigger value="workflow" className="gap-1.5">
              <GitBranch className="h-3.5 w-3.5" />
              Workflow
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-hidden">
          <TabsContent value="chat" className="h-full m-0 p-0">
            <TaskChatPanel task={task} />
          </TabsContent>
          <TabsContent value="prompt" className="h-full m-0 p-0">
            <TaskPromptPanel task={task} />
          </TabsContent>
          <TabsContent value="workflow" className="h-full m-0 p-0">
            <WorkflowView task={task} allTasks={tasks} />
          </TabsContent>
        </div>
      </Tabs>

      <div className="border-t border-border/50 bg-background/40 p-4 space-y-3">
        <RuntimeConfigSelector
          model={task.runtimeConfig.model}
          effort={task.runtimeConfig.effort}
        />
        <Separator />
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground/80">
          <span>📎 {task.attachments.length} attachments</span>
          <span>📦 {task.artifacts.length} artifacts</span>
          <span>📊 {task.metrics.tokens.total} tok · ${task.metrics.cost.toFixed(4)} · {formatDuration(task.metrics.durationMs)}</span>
        </div>
        {task.subtaskIds.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground/80">
            <span className="font-medium text-foreground/90">Subtasks:</span>
            {task.subtaskIds.map(stId => {
              const st = getTaskById(stId);
              return st ? (
                <div key={stId} className="ml-2 flex items-center gap-2">
                  <StatusDot status={st.status} />
                  <span>▸ {st.id.slice(0, 8)} ({st.assignedTo} / {getStatusLabel(st.status)})</span>
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
