import { ClipboardEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CheckCircle, FileText, GitBranch, LoaderCircle, Paperclip, Pause, Play, Send, Split, Upload, X } from "lucide-react";
import { z } from "zod";
import { ChatMessageContent } from "./ChatMessageContent";
import type { AgentLogEntry, ChatMessage, Task, TaskFiles } from "../types";

const formSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  projectTargets: z.array(z.string())
});

type FormValues = z.infer<typeof formSchema>;
type LocalChatMessage = ChatMessage & { pending?: boolean };
type AttachmentItem = { id: string; file: File; status: "pending" | "uploading" | "uploaded" | "failed"; path?: string; error?: string };

type Props = {
  task: Task | null;
  draftTask?: Task | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: { id?: string; title: string; description?: string; projectTargets: string[] }, options?: { execute?: boolean }) => Promise<Task | void>;
  onUploadAttachment: (input: { id?: string; title: string; description?: string; projectTargets: string[] }, file: File) => Promise<{ task: Task; path: string }>;
  onSendComment: (text: string, taskId: string) => Promise<string> | string;
  messages: ChatMessage[];
  logs: AgentLogEntry[];
  logsHasMore: boolean;
  logsLoading: boolean;
  onLoadMoreLogs: (taskId: string) => Promise<unknown>;
  allTasks: Task[];
  files?: TaskFiles;
  onSaveFile: (taskId: string, path: "acceptance.md" | "description.md", content: string) => Promise<void> | void;
  onAction: (task: Task, action: "run" | "interrupt" | "complete" | "decompose") => Promise<void> | void;
};

export function TaskModal({ task, draftTask, open, onClose, onSave, onUploadAttachment, onSendComment, messages, logs, logsHasMore, logsLoading, onLoadMoreLogs, allTasks, files, onSaveFile, onAction }: Props) {
  const [activeTab, setActiveTab] = useState("resumo");
  const [chat, setChat] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [chatAttachments, setChatAttachments] = useState<File[]>([]);
  const [pendingChatMessages, setPendingChatMessages] = useState<LocalChatMessage[]>([]);
  const [chatSending, setChatSending] = useState(false);
  const [draftSaving, setDraftSaving] = useState<"draft" | "execute" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const isDraftMode = !task;
  const currentDraft = draftTask || null;
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
  const descriptionValue = form.watch("description") || "";
  const filteredProjects = projectOptions.filter((project) => project.toLowerCase().includes(projectQuery.toLowerCase()));
  const visibleMessages = useMemo(() => {
    const base = messages.length ? messages : task ? [{ id: "task-empty", role: "assistant" as const, time: "agora", text: "Sem comentarios nesta task." }] : [];
    const persisted = new Set(base.map((message) => `${message.role}:${message.text}`));
    return [...base, ...pendingChatMessages.filter((message) => !persisted.has(`${message.role}:${message.text}`))] as LocalChatMessage[];
  }, [messages, pendingChatMessages, task]);

  useEffect(() => {
    form.reset({
      title: task?.title || "",
      description: task?.description || "",
      projectTargets: task?.projectTargets || []
    });
    setAttachments([]);
    setChatAttachments([]);
    setPendingChatMessages([]);
    setChatSending(false);
    setDraftSaving(null);
    setActiveTab("resumo");
  }, [task, form, open]);

  async function submit(values: FormValues) {
    await onSave({
      id: task?.id,
      title: values.title || "",
      description: values.description,
      projectTargets: values.projectTargets || []
    });
    onClose();
  }

  async function submitDraft(mode: "draft" | "execute") {
    if (draftSaving) return;
    const values = form.getValues();
    setDraftSaving(mode);
    try {
      const saved = await onSave({
        id: currentDraft?.id,
        title: values.title || "",
        description: values.description,
        projectTargets: values.projectTargets || []
      }, { execute: false });
      const savedTask = saved || currentDraft;
      if (savedTask?.id) await uploadPendingAttachments(savedTask.id);
      if (mode === "execute" && savedTask?.id) {
        await onSave({
          id: savedTask.id,
          title: values.title || "",
          description: values.description,
          projectTargets: values.projectTargets || []
        }, { execute: true });
        onClose();
      }
    } finally {
      setDraftSaving(null);
    }
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    if (chatSending) return;
    if (!task?.id) return;
    const value = chat.trim();
    if (!value && chatAttachments.length === 0) return;
    const attachmentNote = chatAttachments.length ? `\n\nAnexos: ${chatAttachments.map((file) => file.name).join(", ")}` : "";
    const prompt = `${value}${attachmentNote}`;
    const userMessage: LocalChatMessage = { id: `local-task-user-${Date.now()}`, role: "user", time: "agora", text: prompt };
    const thinkingMessage: LocalChatMessage = { id: `local-task-thinking-${Date.now()}`, role: "assistant", time: "agora", text: "Registrando...", pending: true };
    setChat("");
    setChatAttachments([]);
    setChatSending(true);
    setPendingChatMessages((current) => [...current, userMessage, thinkingMessage]);
    try {
      const reply = await onSendComment(prompt, task.id);
      setPendingChatMessages((current) => current.map((message) => message.id === thinkingMessage.id ? { ...message, text: reply || "Comando processado.", pending: false } : message));
    } catch (error) {
      const reply = `Erro do daemon: ${error instanceof Error ? error.message : String(error)}`;
      setPendingChatMessages((current) => current.map((message) => message.id === thinkingMessage.id ? { ...message, text: reply, pending: false } : message));
    } finally {
      setChatSending(false);
    }
  }

  function addAttachments(nextFiles: FileList | File[], upload = isDraftMode) {
    const nextItems = toAttachmentItems(Array.from(nextFiles));
    setAttachments((current) => mergeFiles(current, nextItems));
    if (upload && nextItems.length) void uploadAttachmentItems(nextItems);
  }

  function addChatAttachments(nextFiles: FileList | File[]) {
    setChatAttachments((current) => mergeChatFiles(current, Array.from(nextFiles)));
  }

  function dropFiles(event: DragEvent<HTMLElement>, target: "task" | "chat") {
    event.preventDefault();
    if (target === "task") addAttachments(event.dataTransfer.files);
    else addChatAttachments(event.dataTransfer.files);
  }

  function pasteFiles(event: ClipboardEvent<HTMLElement>) {
    const pasted = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith("image/"));
    if (!pasted.length) return;
    event.preventDefault();
    addAttachments(pasted, true);
  }

  async function uploadAttachmentItems(items: AttachmentItem[], taskIdInput?: string) {
    let taskId = taskIdInput || currentDraft?.id;
    for (const item of items) {
      setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploading", error: undefined } : candidate));
      try {
        const values = form.getValues();
        const result = await onUploadAttachment({
          id: taskId,
          title: values.title || "",
          description: values.description,
          projectTargets: values.projectTargets || []
        }, item.file);
        taskId = result.task.id;
        setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "uploaded", path: result.path } : candidate));
      } catch (error) {
        setAttachments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "failed", error: error instanceof Error ? error.message : String(error) } : candidate));
      }
    }
  }

  async function uploadPendingAttachments(taskId: string) {
    const pending = attachments.filter((item) => item.status === "pending" || item.status === "failed");
    if (pending.length) await uploadAttachmentItems(pending, taskId);
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
          {isDraftMode ? (
            <form className="new-task-draft-form" onSubmit={form.handleSubmit(() => submitDraft("draft"))} onPaste={pasteFiles}>
              <div className="field">
                <label htmlFor="task-title">Título <span>opcional</span></label>
                <input id="task-title" className="input" {...form.register("title")} />
              </div>
              <div className="field draft-description-field">
                <label htmlFor="task-description">Descrição</label>
                <CodeMirror
                  aria-label="Descrição"
                  basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
                  className="markdown-editor"
                  extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
                  height="100%"
                  id="task-description"
                  onChange={(value) => form.setValue("description", value, { shouldDirty: true, shouldValidate: true })}
                  placeholder="Descreva a task em Markdown"
                  value={descriptionValue}
                />
              </div>
              <AttachmentDropzone files={attachments} onClick={() => fileInputRef.current?.click()} onDrop={(event) => dropFiles(event, "task")} onRemove={(index) => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              <input ref={fileInputRef} className="sr-only" type="file" multiple onChange={(event) => event.target.files && addAttachments(event.target.files)} />
              <div className="flex justify-end gap-2 border-t border-zinc-800 p-4">
                <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
                <button type="button" className="button-secondary" disabled={Boolean(draftSaving)} onClick={() => void submitDraft("draft")}>{draftSaving === "draft" ? "Salvando..." : "Salvar"}</button>
                <button type="button" className="button-primary" disabled={Boolean(draftSaving)} onClick={() => void submitDraft("execute")}>{draftSaving === "execute" ? "Executando..." : "Salvar e executar"}</button>
              </div>
            </form>
          ) : (
          <div className={`grid min-h-0 flex-1 grid-cols-1 ${activeTab === "resumo" ? "lg:grid-cols-2" : ""}`}>
            <form className={`flex min-h-0 flex-col ${activeTab === "resumo" ? "border-r border-zinc-800" : ""}`} onSubmit={form.handleSubmit(submit)}>
              <Tabs.Root value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
                <Tabs.List id="taskTabs" className="tabs-list">
                  {["resumo", "execucao", "logs", "worktree", "dependencias", "subtasks", "hooks", "eventos", "arquivos"].map((tab) => (
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
                    <Panel title="Runtime" lines={[
                      `status: ${task?.status || "nova"}`,
                      `agent: ${task?.routing?.currentAgent || "assistant"}`,
                      `run: ${typeof task?.agent === "object" ? task.agent?.currentRunId || "nenhum" : "nenhum"}`,
                      ...(task?.failure?.reason ? [`falha: ${task.failure.reason}`] : [])
                    ]} />
                    {task ? <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "run")}><Play size={15} />Rodar</button>
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "interrupt")}><Pause size={15} />Pausar</button>
                      <button type="button" className="button-secondary" onClick={() => onAction(task, "decompose")}><Split size={15} />Decompor</button>
                      <button type="button" className="button-primary" onClick={() => onAction(task, "complete")}><CheckCircle size={15} />Completar</button>
                    </div> : null}
                  </Tabs.Content>
                  <Tabs.Content value="logs" className="task-logs-tab">
                    <TerminalLogs logs={logs} loading={logsLoading} hasMore={logsHasMore} emptyText={task?.id ? undefined : "Salve a task para iniciar logs."} onLoadMore={() => task?.id ? onLoadMoreLogs(task.id) : Promise.resolve()} />
                  </Tabs.Content>
                  <Tabs.Content value="worktree"><Panel title="Worktree da task" lines={[`branch: ${task?.worktree?.branch || "a definir"}`, `path: ${task?.worktree?.path || "nao criado"}`, `merge target: ${task?.worktree?.mergeTarget || "main"}`]} /></Tabs.Content>
                  <Tabs.Content value="dependencias"><Panel title="Contratos da task" lines={[`needs -> ${(task?.dependencies?.needs || []).join(", ") || "nenhum"}`, `${task?.id || "task"} -> provides`, (task?.dependencies?.provides || []).join(", ") || "nenhum"]} /></Tabs.Content>
                  <Tabs.Content value="subtasks">
                    <Panel title="Subtasks paralelas" lines={subtasks.length ? subtasks.map((item) => `${item.id} [${item.status}] ${item.title}`) : ["Use decompor para criar subtasks com needs/provides e agents sugeridos."]} />
                  </Tabs.Content>
                  <Tabs.Content value="hooks"><Panel title="Hooks da task" lines={task?.hooks?.active?.length ? task.hooks.active : ["nenhum hook ativo"]} /></Tabs.Content>
                  <Tabs.Content value="eventos"><Panel title="Timeline" lines={(files?.events?.length ? files.events.slice(-8).map((event) => `${event.type || "event"} · ${event.ts || ""}`) : [`updated: ${task?.updatedAt || "nao persistida"}`])} /></Tabs.Content>
                  <Tabs.Content value="arquivos"><Panel title="Arquivos da task" lines={[...(files?.files || ["task.yaml", "description.md", "dependencies.yaml", "events.jsonl"]), ...attachments.map((item) => item.file.name)]} /></Tabs.Content>
                </div>
              </Tabs.Root>
              <div className="flex justify-end gap-2 border-t border-zinc-800 p-4">
                <button type="button" className="button-secondary" onClick={onClose}>Cancelar</button>
                <button className="button-primary">Salvar task</button>
              </div>
            </form>
            {activeTab === "resumo" ? (
              <section className="task-comments-panel">
                <div className="task-comments-head">
                  <div>
                    <h3>Comentarios</h3>
                    <p>{task?.id || "nova task"} · usuario e agents</p>
                  </div>
                  <span>{visibleMessages.length}</span>
                </div>
                <div className="task-comments-stream">
                  {visibleMessages.map((message) => (
                    <article className={`task-comment-card ${message.role === "assistant" ? "assistant" : "user"}`} key={message.id}>
                      <div className="task-comment-avatar">{commentInitial(message)}</div>
                      <div className="task-comment-content">
                        <div className="task-comment-meta">
                          <span>{message.persona || message.role}</span>
                          <time>{message.time}</time>
                        </div>
                        <ChatMessageContent className="task-chat-bubble" text={message.text} pending={message.pending} />
                      </div>
                    </article>
                  ))}
                  {task?.worktree?.branch ? <div className="task-comment-branch"><GitBranch size={13} />{task.worktree.branch}</div> : null}
                </div>
                <form className="task-chat-composer" onSubmit={submitChat} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropFiles(event, "chat")}>
                  <textarea className="textarea" placeholder="Comente ou responda ao agent" value={chat} disabled={chatSending || !task?.id} onChange={(event) => setChat(event.target.value)} />
                  <div className="task-chat-actions">
                    <button type="button" className="icon-button" aria-label="Anexar arquivos" disabled={chatSending} title={chatAttachments.map((file) => file.name).join(", ")} onClick={() => chatFileInputRef.current?.click()}><Paperclip size={16} /></button>
                    <input ref={chatFileInputRef} className="sr-only" type="file" multiple disabled={chatSending} onChange={(event) => event.target.files && addChatAttachments(event.target.files)} />
                    <button className="icon-button" aria-label="Enviar" disabled={chatSending}>{chatSending ? <LoaderCircle className="spinner" size={16} /> : <Send size={16} />}</button>
                  </div>
                </form>
              </section>
            ) : null}
          </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function toAttachmentItems(files: File[]) {
  return files.map((file) => ({ id: `attachment-${Date.now()}-${Math.random().toString(16).slice(2)}`, file, status: "pending" as const }));
}

function mergeFiles(current: AttachmentItem[], next: AttachmentItem[]) {
  const keys = new Set(current.map((item) => `${item.file.name}:${item.file.size}`));
  return [...current, ...next.filter((item) => !keys.has(`${item.file.name}:${item.file.size}`))];
}

function mergeChatFiles(current: File[], next: File[]) {
  const keys = new Set(current.map((file) => `${file.name}:${file.size}`));
  return [...current, ...next.filter((file) => !keys.has(`${file.name}:${file.size}`))];
}

function AttachmentDropzone({ files, onClick, onDrop, onRemove }: { files: AttachmentItem[]; onClick: () => void; onDrop: (event: DragEvent<HTMLDivElement>) => void; onRemove: (index: number) => void }) {
  return (
    <div className="attachment-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <button type="button" className="button-secondary" onClick={onClick}><Upload size={15} />Upload</button>
      <div className="attachment-list">
        {files.length ? files.map((item, index) => (
          <article className="attachment-card" key={item.id}>
            <FileText size={16} />
            <span>{item.file.name}{item.status !== "pending" ? ` · ${item.status}` : ""}</span>
            <button type="button" className="icon-button" aria-label="Remover arquivo" onClick={() => onRemove(index)}><X size={13} /></button>
          </article>
        )) : <span className="attachment-empty">Solte arquivos aqui</span>}
      </div>
    </div>
  );
}

function commentInitial(message: ChatMessage) {
  return String(message.persona || message.agentId || message.role || "?").slice(0, 1).toUpperCase();
}

function TerminalLogs({ logs, loading, hasMore, emptyText = "Sem logs para esta task.", onLoadMore }: { logs: AgentLogEntry[]; loading: boolean; hasMore: boolean; emptyText?: string; onLoadMore: () => Promise<unknown> }) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeAgent, setActiveAgent] = useState("all");
  const linesRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScroll = useRef(false);
  const agents = useMemo(() => agentTabs(logs), [logs]);
  const displayLogs = useMemo(() => {
    const filtered = activeAgent === "all" ? logs : logs.filter((log) => logAgent(log) === activeAgent);
    return coalesceLogs(filtered).slice().reverse();
  }, [activeAgent, logs]);

  useEffect(() => {
    if (activeAgent !== "all" && !agents.includes(activeAgent)) setActiveAgent("all");
  }, [activeAgent, agents]);

  useEffect(() => {
    const el = linesRef.current;
    if (!el) return;
    if (skipNextAutoScroll.current) {
      skipNextAutoScroll.current = false;
      return;
    }
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeAgent, displayLogs.length]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    skipNextAutoScroll.current = true;
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll() {
    const el = linesRef.current;
    if (!el || el.scrollTop > 24) return;
    void loadMore();
  }

  return (
    <section className="terminal-log-panel" aria-label="Logs dos agents">
      <div className="terminal-log-toolbar">
        <span>{loading ? "carregando" : `${displayLogs.length} eventos`}</span>
        <span>{loadingMore ? "carregando anteriores" : hasMore ? "role para cima" : "historico completo"}</span>
      </div>
      <div className="terminal-log-agent-tabs" role="tablist" aria-label="Agents">
        <button type="button" className={activeAgent === "all" ? "active" : ""} onClick={() => setActiveAgent("all")}>Todos</button>
        {agents.map((agent) => (
          <button type="button" className={activeAgent === agent ? "active" : ""} key={agent} onClick={() => setActiveAgent(agent)}>{agent}</button>
        ))}
      </div>
      <div className="terminal-log-lines" ref={linesRef} onScroll={handleScroll}>
        {displayLogs.length ? displayLogs.map((log) => {
          const details = prettyLogDetails(log);
          return (
            <article className={`pretty-log-entry ${prettyLogKind(log)}`} key={log.id}>
              <div className="pretty-log-head">
                <span className="pretty-log-dot" />
                <span className="pretty-log-title">{prettyLogTitle(log)}</span>
                <span className="pretty-log-time">{formatLogTime(log.ts)}</span>
              </div>
              <div className="pretty-log-body">
                {prettyLogLines(log).map((line, index) => (
                  <div className="pretty-log-row" key={`${log.id}-${index}`}>
                    <span className="pretty-log-prefix">{index === 0 ? "└" : " "}</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              {details.length ? (
                <div className="pretty-log-details">
                  {details.map((detail, index) => (
                    <div className="pretty-log-detail" key={`${log.id}-${detail.label}-${index}`}>
                      <span>{detail.label}</span>
                      <pre>{detail.value}</pre>
                    </div>
                  ))}
                </div>
              ) : null}
              {log.raw ? (
                <details className="pretty-log-raw">
                  <summary>raw</summary>
                  <pre>{JSON.stringify(log.raw, null, 2)}</pre>
                </details>
              ) : null}
            </article>
          );
        }) : <div className="terminal-log-empty">{loading ? "Aguardando logs..." : emptyText}</div>}
      </div>
    </section>
  );
}

function logAgent(log: AgentLogEntry) {
  return log.agentId || log.actor || "system";
}

function agentTabs(logs: AgentLogEntry[]) {
  return Array.from(new Set(logs.map(logAgent).filter(Boolean))).sort();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rawProvider(log: AgentLogEntry) {
  const raw = objectValue(log.raw);
  return objectValue(raw.providerEvent || raw);
}

function nestedString(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) current = objectValue(current)[key];
  return typeof current === "string" || typeof current === "number" ? String(current) : "";
}

function transcriptKey(log: AgentLogEntry) {
  const raw = objectValue(log.raw);
  const provider = rawProvider(log);
  const eventType = String(raw.providerEventType || provider.type || "");
  const toolCall = objectValue(raw.toolCall);
  const toolResult = objectValue(raw.toolResult);
  const responseId = nestedString(provider, ["message", "responseId"]) || nestedString(provider, ["assistantMessageEvent", "partial", "responseId"]);
  const contentIndex = nestedString(provider, ["assistantMessageEvent", "contentIndex"]);
  const toolId = String(toolCall.id || toolResult.id || nestedString(provider, ["message", "content", "0", "id"]) || "");
  const toolName = String(toolCall.name || toolCall.tool || toolResult.name || log.text.split(/\s+/)[0] || "");
  return [
    log.runId || "",
    logAgent(log),
    log.category || "",
    log.role || "",
    responseId || eventType || log.type,
    contentIndex,
    toolId || toolName
  ].join("\u0001");
}

function shouldShowLog(log: AgentLogEntry) {
  if (log.type !== "agent.transcript") return true;
  if (log.role === "user") return false;
  if (log.category === "event") return ["agent_start", "agent_end"].includes(log.text);
  return Boolean(String(log.text || "").trim()) && log.text !== "[]";
}

function coalesceLogs(logs: AgentLogEntry[]) {
  const result: AgentLogEntry[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    if (!shouldShowLog(log)) continue;
    const key = log.type === "agent.transcript" ? transcriptKey(log) : log.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(log);
  }
  return result;
}

function prettyLogKind(log: AgentLogEntry) {
  if (log.category === "tool_call" || log.type === "agent.tool_call") return "tool";
  if (log.category === "tool_result" || log.type === "agent.tool_result") return "result";
  if (log.category === "reasoning") return "reasoning";
  if (/failed|blocked|error/i.test(log.type)) return "error";
  if (/completed|prompt_sent|started|run/.test(log.type)) return "success";
  return "message";
}

function prettyLogTitle(log: AgentLogEntry) {
  const actor = log.agentId || log.actor || "agent";
  if (log.category === "tool_call" || log.type === "agent.tool_call") return `${actor} chamou ${log.text.split(/\s+/).slice(0, 2).join(" ")}`;
  if (log.category === "tool_result" || log.type === "agent.tool_result") return `${actor} recebeu resultado`;
  if (log.category === "reasoning") return `${actor} raciocinando`;
  if (log.type === "agent.transcript" && log.text === "agent_start") return `${actor} iniciou streaming`;
  if (log.type === "agent.transcript" && log.text === "agent_end") return `${actor} encerrou streaming`;
  if (log.type === "agent.transcript") return `${actor} respondeu`;
  if (log.type === "agent.prompt_sent") return `Prompt sent`;
  if (log.type === "agent.started") return `Started ${actor}`;
  if (log.type === "agent.completed") return `Completed task`;
  if (log.type === "human.input_requested" || log.type === "agent.input_requested") return `Waiting for user`;
  if (log.type === "task.comment" || log.type === "human.input_received") return `User replied`;
  return log.type.replace(/^agent\./, "").replaceAll("_", " ");
}

function prettyLogLines(log: AgentLogEntry) {
  const raw = (log.raw && typeof log.raw === "object" ? log.raw : {}) as Record<string, unknown>;
  const command = (raw.command && typeof raw.command === "object" ? raw.command : {}) as Record<string, unknown>;
  const lines: string[] = [];
  const text = String(log.text || "").trim();
  if (text) lines.push(text);
  if (command.type) lines.push(`command ${String(command.type)}`);
  if (command.taskId) lines.push(`task ${String(command.taskId)}`);
  if (raw.cwd) lines.push(`cwd ${String(raw.cwd)}`);
  if (raw.path) lines.push(`path ${String(raw.path)}`);
  if (raw.ok !== undefined) lines.push(`ok ${String(raw.ok)}`);
  return lines.length ? lines.slice(0, 4) : [log.type];
}

function compactJson(value: unknown, max = 2400) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function contentDetail(provider: Record<string, unknown>) {
  const message = objectValue(provider.message);
  const content = Array.isArray(message.content) ? message.content : [];
  const details = content.flatMap((part, index) => {
    const item = objectValue(part);
    const type = String(item.type || `content_${index}`);
    const value = item.text || item.content || item.input || item.arguments || item.output || item.result;
    return value === undefined ? [] : [{ label: type, value: compactJson(value) }];
  });
  return details.slice(0, 4);
}

function prettyLogDetails(log: AgentLogEntry) {
  const raw = objectValue(log.raw);
  const provider = rawProvider(log);
  const details: { label: string; value: string }[] = [];
  const toolCall = objectValue(raw.toolCall);
  const toolResult = objectValue(raw.toolResult);
  const command = objectValue(raw.command);
  if (toolCall.name || toolCall.tool || toolCall.arguments || toolCall.input) {
    details.push({ label: "tool call", value: compactJson({ name: toolCall.name || toolCall.tool, arguments: toolCall.arguments || toolCall.input || toolCall.params }) });
  }
  if (toolResult.output || toolResult.result || toolResult.content || toolResult.text) {
    details.push({ label: "tool result", value: compactJson(toolResult.output || toolResult.result || toolResult.content || toolResult.text) });
  }
  if (command.type) details.push({ label: "command", value: compactJson(command) });
  if (raw.classification || raw.targetRole || raw.reason) {
    details.push({ label: "routing", value: compactJson({ classification: raw.classification, targetRole: raw.targetRole, order: raw.order, reason: raw.reason }) });
  }
  details.push(...contentDetail(provider));
  return details.slice(0, 5);
}

function formatLogTime(ts: string) {
  if (!ts) return "--:--:--";
  try {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ts));
  } catch {
    return ts;
  }
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
