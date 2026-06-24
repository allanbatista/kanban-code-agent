import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare, GitBranch, History, Table, Pencil, Check, X, ArrowUpLeft } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './StatusBadge';
import { TaskChatPanel } from './TaskChatPanel';
import { TaskHistoryPanel } from './TaskHistoryPanel';
import { TaskSummaryPanel } from './TaskSummaryPanel';
import { WorkflowView } from '@/components/workflow/WorkflowView';
import { useKanbanStore } from '@/stores/kanbanStore';
import { TREE_COLORS, defaultTreeColor } from './TaskCard';

interface TaskDrawerProps {
  taskId: string;
  defaultTab: 'chat' | 'workflow' | 'history' | 'summary';
  onClose: () => void;
}

const TABS = [
  { value: 'chat', icon: MessageSquare, label: 'Chat' },
  { value: 'workflow', icon: GitBranch, label: 'Workflow' },
  { value: 'history', icon: History, label: 'History' },
  { value: 'summary', icon: Table, label: 'Summary' },
] as const;

export function TaskDrawer({ taskId, defaultTab, onClose }: TaskDrawerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tasks, getTaskById, setTasks, familyColors, setFamilyColor, getTaskRootId } = useKanbanStore();
  const task = getTaskById(taskId);

  const rootId = task ? getTaskRootId(task.id) : taskId;
  const currentColor = familyColors[rootId] ?? defaultTreeColor(rootId);

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [customColor, setCustomColor] = useState(currentColor);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const pickerContentRef = useRef<HTMLDivElement>(null);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });

  const updatePickerPos = useCallback(() => {
    if (colorBtnRef.current) {
      const rect = colorBtnRef.current.getBoundingClientRect();
      setPickerPos({ top: rect.bottom + 8, left: rect.left });
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (pickerContentRef.current?.contains(target)) return;
      if (colorBtnRef.current?.contains(target)) return;
      setColorPickerOpen(false);
    }
    if (colorPickerOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [colorPickerOpen]);

  useEffect(() => {
    setCustomColor(currentColor);
  }, [currentColor]);

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('task', taskId);
    params.set('tab', tab);
    setSearchParams(params, { replace: true });
  };

  // Switch the open drawer to another task (subtask node/row or parent button),
  // keeping the current tab. Replaces the current modal in place.
  const openTask = useCallback(
    (nextTaskId: string) => {
      const params = new URLSearchParams(searchParams);
      params.set('task', nextTaskId);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const startEditing = () => {
    if (!task) return;
    setEditTitle(task.title);
    setEditing(true);
  };

  const saveTitle = () => {
    if (!task || !editTitle.trim()) return;
    setTasks(tasks.map(t => t.id === task.id ? { ...t, title: editTitle.trim() } : t));
    setEditing(false);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditTitle('');
  };

  if (!task) {
    return (
      <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-lg">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Task não encontrada</h2>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[1080px] min-h-0 w-[90vw] max-w-[1920px] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <Tabs
          defaultValue={defaultTab}
          onValueChange={handleTabChange}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* Header: título editável + abas */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border/50 bg-background/30 backdrop-blur-sm px-5 py-2">
            {task.parentId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={() => openTask(task.parentId!)}
                title={`Abrir task pai (${task.parentId})`}
              >
                <ArrowUpLeft className="h-3 w-3" />
                Task pai
              </Button>
            )}
            <div className="min-w-0 flex-1">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    className="h-7 text-sm font-semibold"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveTitle();
                      if (e.key === 'Escape') cancelEditing();
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveTitle}>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEditing}>
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-sm font-semibold">{task.title}</h2>
                  <button
                    onClick={startEditing}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                    title="Editar título"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <div className="relative flex items-center">
                    <button
                      ref={colorBtnRef}
                      onClick={(e) => { e.stopPropagation(); updatePickerPos(); setColorPickerOpen(o => !o); setCustomColor(currentColor); }}
                      className="shrink-0 h-4 w-4 rounded border border-border/60 cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all"
                      style={{ backgroundColor: currentColor }}
                      title="Cor da família"
                    />
                    {colorPickerOpen && createPortal(
                      <div
                        ref={pickerContentRef}
                        className="fixed z-[1000] rounded-lg border border-border/60 bg-card/95 backdrop-blur-md shadow-xl p-3 w-[220px]"
                        style={{ top: pickerPos.top, left: pickerPos.left }}
                      >
                        <HexColorPicker color={customColor} onChange={setCustomColor} className="!w-full !h-[160px]" />
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={customColor}
                            onChange={e => setCustomColor(e.target.value)}
                            className="flex-1 h-6 rounded border border-border/60 bg-background/50 px-2 text-[10px] font-mono"
                            placeholder="#RRGGBB"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); setFamilyColor(rootId, customColor); setColorPickerOpen(false); }}
                            className="h-6 px-2 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/80"
                          >
                            OK
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {TREE_COLORS.map(c => (
                            <button
                              key={c}
                              onClick={(e) => { e.stopPropagation(); setCustomColor(c); setFamilyColor(rootId, c); setColorPickerOpen(false); }}
                              className="h-4 w-4 rounded border border-border/40 hover:ring-1 hover:ring-primary/50 transition-all"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>
                    , document.body)}
                  </div>
                </div>
              )}
            </div>
            <TabsList className="h-8 shrink-0 ml-auto p-0 mr-20">
              {TABS.map(({ value, icon: Icon, label }) => (
                <TabsTrigger key={value} value={value} className="h-7 gap-1 px-2.5 text-xs data-[state=active]:border-primary data-[state=active]:bg-primary/10">
                  <Icon className="h-3 w-3" />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <TabsContent value="chat" className="h-full m-0 p-0">
              <TaskChatPanel task={task} />
            </TabsContent>
            <TabsContent value="workflow" className="h-full m-0 p-0">
              <WorkflowView task={task} allTasks={tasks} onNodeClick={openTask} />
            </TabsContent>
            <TabsContent value="history" className="h-full m-0 p-0">
              <TaskHistoryPanel task={task} />
            </TabsContent>
            <TabsContent value="summary" className="h-full m-0 p-0">
              <TaskSummaryPanel task={task} onRowClick={openTask} />
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer: agent + status + métricas */}
        <div className="flex shrink-0 items-center gap-4 border-t border-border/50 bg-background/30 backdrop-blur-sm px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{task.assignedTo}</span>
            <StatusBadge status={task.status} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70">
            <span>🤖 {task.runtimeConfig.model} · {task.runtimeConfig.effort}</span>
            <span>📎 {task.attachments.length}</span>
            <span>📦 {task.artifacts.length}</span>
            <span>{task.metrics.tokens.total} tok · ${task.metrics.cost.toFixed(4)} · {formatDuration(task.metrics.durationMs)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
