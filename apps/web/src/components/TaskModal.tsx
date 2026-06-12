import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CheckCircle, FileText, GitBranch, Paperclip, Pause, Play, Send, Split, Upload, X } from "lucide-react";
import { z } from "zod";
import type { ChatMessage, Task, TaskFiles } from "../types";

const formSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectTargets: z.array(z.string())
});

type FormValues = z.infer<typeof formSchema>;

type Props = {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; title: string; description?: string; priority: string; kind: string; projectTargets: string[] }) => Promise<void>;
  onSendAssistant: (prompt: string, taskId?: string) => Promise<string> | string;
  messages: ChatMessage[];
  allTasks: Task[];
  files?: TaskFiles;
  onSaveFile: (taskId: string, path: "acceptance.md" | "description.md", content: string) => Promise<void> | void;
  onAction: (task: Task, action: "run" | "interrupt" | "complete" | "decompose") => Promise<void> | void;
};

export function TaskModal({ task, open, onClose, onSave, onSendAssistant, messages, allTasks, files, onSaveFile, onAction }: Props) {
  const [chat, setChat] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const subtasks = task ? allTasks.filter((item) => item.worktree?.parentTaskId === task.id) : [];
  const projectOptions = useMemo(() => Array.from(new Set([
    ...allTasks.flatMap((item) => item.projectTargets || []),
    ...(task?.projectTargets || []),
    "kanban-code-agent"
  ])).sort(), [allTasks, task?.projectTargets]);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", description: "", projectTargets: [] }
  });
  const selectedProjects = form.watch("projectTargets") || [];
  const filteredProjects = projectOptions.filter((project) => project.toLowerCase().includes(projectQuery.toLowerCase()));

  useEffect(() => {
    form.reset({
      title: task?.title || "",
      description: task?.description || "",
      projectTargets: task?.projectTargets || []
    });
    setAttachments([]);
    setChatAttachments([]);
  }, [task, form, open]);

  async function submit(values: FormValues) {
    await onSave({
      id: task?.id,
      title: values.title,
      description: values.description,
      priority: task?.priority || "medium",
      kind: task?.kind || "task",
      projectTargets: values.projectTargets || []
    });
    onClose();
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    const value = chat.trim();
    if (!value && chatAttachments.length === 0) return;
    const attachmentNote = chatAttachments.length ? `\n\nAnexos: ${chatAttachments.map((file) => file.name).join(", ")}` : "";
    setChat("");
    setChatAttachments([]);
    await onSendAssistant(`${value}${attachmentNote}`, task?.id);
  }

  function addAttachments(nextFiles: FileList | File[]) {
    setAttachments((current) => mergeFiles(current, Array.from(nextFiles)));
  }

  function addChatAttachments(nextFiles: FileList | File[]) {
    setChatAttachments((current) => mergeFiles(current, Array.from(nextFiles)));
  }

  function dropFiles(event: DragEvent<HTMLElement>, target: "task" | "chat") {
    event.preventDefault();
    if (target === "task") addAttachments(event.dataTransfer.files);
    else addChatAttachments(event.dataTransfer.files);
  }

  function toggleProject(project: string) {
    const next = selectedProjects.includes(project)
      ? selectedProjects.filter((item) => item !== project)
      : [...selectedProjects, project];
    form.setValue("projectTargets", next, { shouldDirty: true, shouldValidate: true });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="task-dialog">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{task ? task.title : "Nova task"}</Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-500">{task?.id || "Persistida pelo daemon"}</Dialog.Description>
            </div>
            <Dialog.Close className="icon-button"><X size={16} /></Dialog.Close>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <form className="flex min-h-0 flex-col border-r border-zinc-800" onSubmit={form.handleSubmit(submit)}>
              <Tabs.Root defaultValue="resumo" className="flex min-h-0 flex-1 flex-col">
                <Tabs.List id="taskTabs" className="tabs-list">
                  {["resumo", "execucao", "worktree", "dependencias", "subtasks", "hooks", "eventos", "arquivos"].map((tab) => (
                    <Tabs.Trigger className="tabs-trigger" key={tab} value={tab}>{tab}</Tabs.Trigger>
                  ))}
                </Tabs.List>
                <div className="task-tab-body">
                  <Tabs.Content value="resumo" className="task-summary">
                    <div className="field">
                      <label htmlFor="task-title">Título</label>
                      <input id="task-title" className="input" {...form.register("title")} />
                    </div>
                    <div className="field">
                      <span>Projetos alvo</span>
                      <div className="multi-select">
                        <div className="multi-select-values">
                          {selectedProjects.map((project) => (
                            <button type="button" className="pill" key={project} onClick={() => toggleProject(project)}>{project}<X size={12} /></button>
                          ))}
                          <input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="Buscar projeto" />
                        </div>
                        <div className="multi-select-menu">
                          {filteredProjects.map((project) => (
                            <label key={project} className="multi-select-option">
                              <input type="checkbox" checked={selectedProjects.includes(project)} onChange={() => toggleProject(project)} />
                              {project}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="field task-description-field">
                      <label htmlFor="task-description">Descrição</label>
                      <textarea id="task-description" className="textarea" {...form.register("description")} />
                    </div>
                    <AttachmentDropzone files={attachments} onClick={() => fileInputRef.current?.click()} onDrop={(event) => dropFiles(event, "task")} onRemove={(index) => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                    <input ref={fileInputRef} className="sr-only" type="file" multiple onChange={(event) => event.target.files && addAttachments(event.target.files)} />
                  </Tabs.Content>
                  <Tabs.Content value="execucao">
                    <Panel title="Runtime" lines={[`status: ${task?.status || "nova"}`, `agent: ${task?.routing?.currentAgent || "assistant"}`, `run: ${typeof task?.agent === "object" ? task.agent?.currentRunId || "nenhum" : "nenhum"}`]} />
                    {task ? <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "run")}><Play size={15} />Rodar</button>
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "interrupt")}><Pause size={15} />Pausar</button>
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "decompose")}><Split size={15} />Decompor</button>
                      <button type="button" className="button-primary" onClick={() => onAction(task, "complete")}><CheckCircle size={15} />Completar</button>
                    </div> : null}
                  </Tabs.Content>
                  <Tabs.Content value="worktree"><Panel title="Worktree da task" lines={[`branch: ${task?.worktree?.branch || "a definir"}`, `path: ${task?.worktree?.path || "nao criado"}`, `merge target: ${task?.worktree?.mergeTarget || "main"}`]} /></Tabs.Content>
                  <Tabs.Content value="dependencias"><Panel title="Contratos da task" lines={[`needs -> ${(task?.dependencies?.needs || []).join(", ") || "nenhum"}`, `${task?.id || "task"} -> provides`, (task?.dependencies?.provides || []).join(", ") || "nenhum"]} /></Tabs.Content>
                  <Tabs.Content value="subtasks">
                    <Panel title="Subtasks paralelas" lines={subtasks.length ? subtasks.map((item) => `${item.id} [${item.status}] ${item.title}`) : ["Use decompor para criar subtasks com needs/provides e agents sugeridos."]} />
                  </Tabs.Content>
                  <Tabs.Content value="hooks"><Panel title="Hooks da task" lines={task?.hooks?.active?.length ? task.hooks.active : ["nenhum hook ativo"]} /></Tabs.Content>
                  <Tabs.Content value="eventos"><Panel title="Timeline" lines={(files?.events?.length ? files.events.slice(-8).map((event) => `${event.type || "event"} · ${event.ts || ""}`) : [`updated: ${task?.updatedAt || "nao persistida"}`])} /></Tabs.Content>
                  <Tabs.Content value="arquivos"><Panel title="Arquivos da task" lines={[...(files?.files || ["task.yaml", "description.md", "dependencies.yaml", "events.jsonl"]), ...attachments.map((file) => file.name)]} /></Tabs.Content>
                </div>
              </Tabs.Root>
              <div className="flex justify-end gap-2 border-t border-zinc-800 p-4">
                <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
                <button className="button-primary">Salvar task</button>
              </div>
            </form>
            <section className="flex min-h-0 flex-col">
              <div className="border-b border-zinc-800 p-4">
                <h3 className="text-sm font-semibold">Assistant da task</h3>
                <p className="text-xs text-zinc-500">{task?.id || "nova task"} · agent assistant</p>
              </div>
              <div className="flex-1 space-y-3 overflow-auto p-4 text-sm text-zinc-300">
                {(messages.length ? messages : task ? [{ id: "task-welcome", role: "assistant" as const, time: "agora", text: `Assistant dedicado para ${task.id}.` }] : []).map((message) => (
                  <article className={message.role === "assistant" ? "chat-assistant" : "chat-user"} key={message.id}>
                    <div className="text-[11px] uppercase text-zinc-500">{message.role} · {message.time}</div>
                    <p className="mt-1">{message.text}</p>
                  </article>
                ))}
                {task?.worktree?.branch ? <div className="flex items-center gap-2 text-xs text-zinc-500"><GitBranch size={13} />{task.worktree.branch}</div> : null}
              </div>
              <form className="task-chat-composer" onSubmit={submitChat} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropFiles(event, "chat")}>
                <textarea className="textarea" placeholder="Pergunte sobre escopo" value={chat} onChange={(event) => setChat(event.target.value)} />
                <div className="task-chat-actions">
                  <button type="button" className="icon-button" aria-label="Anexar arquivos" title={chatAttachments.map((file) => file.name).join(", ")} onClick={() => chatFileInputRef.current?.click()}><Paperclip size={16} /></button>
                  <input ref={chatFileInputRef} className="sr-only" type="file" multiple onChange={(event) => event.target.files && addChatAttachments(event.target.files)} />
                  <button className="icon-button" aria-label="Enviar"><Send size={16} /></button>
                </div>
              </form>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function mergeFiles(current: File[], next: File[]) {
  const keys = new Set(current.map((file) => `${file.name}:${file.size}`));
  return [...current, ...next.filter((file) => !keys.has(`${file.name}:${file.size}`))];
}

function AttachmentDropzone({ files, onClick, onDrop, onRemove }: { files: File[]; onClick: () => void; onDrop: (event: DragEvent<HTMLDivElement>) => void; onRemove: (index: number) => void }) {
  return (
    <div className="attachment-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <button type="button" className="button-secondary" onClick={onClick}><Upload size={15} />Upload</button>
      <div className="attachment-list">
        {files.length ? files.map((file, index) => (
          <article className="attachment-card" key={`${file.name}:${file.size}`}>
            <FileText size={16} />
            <span>{file.name}</span>
            <button type="button" className="icon-button" aria-label="Remover arquivo" onClick={() => onRemove(index)}><X size={13} /></button>
          </article>
        )) : <span className="attachment-empty">Solte arquivos aqui</span>}
      </div>
    </div>
  );
}

function Panel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-zinc-400">
        {lines.map((line) => <li className="rounded-md border border-zinc-800 bg-zinc-950/70 p-2" key={line}>{line}</li>)}
      </ul>
    </section>
  );
}
