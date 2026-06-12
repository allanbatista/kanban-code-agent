import { FormEvent, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CheckCircle, GitBranch, Pause, Play, Send, Split, X } from "lucide-react";
import { z } from "zod";
import type { ChatMessage, Task } from "../types";

const formSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.string().min(1),
  kind: z.string().min(1),
  projectTargets: z.string().optional()
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
  onAction: (task: Task, action: "run" | "interrupt" | "complete" | "decompose") => Promise<void> | void;
};

export function TaskModal({ task, open, onClose, onSave, onSendAssistant, messages, allTasks, onAction }: Props) {
  const [chat, setChat] = useState("");
  const subtasks = task ? allTasks.filter((item) => item.worktree?.parentTaskId === task.id) : [];
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", description: "", priority: "medium", kind: "task", projectTargets: "" }
  });

  useEffect(() => {
    form.reset({
      title: task?.title || "",
      description: task?.description || "",
      priority: task?.priority || "medium",
      kind: task?.kind || "task",
      projectTargets: task?.projectTargets?.join(", ") || ""
    });
  }, [task, form, open]);

  async function submit(values: FormValues) {
    await onSave({
      id: task?.id,
      title: values.title,
      description: values.description,
      priority: values.priority,
      kind: values.kind,
      projectTargets: values.projectTargets?.split(",").map((item) => item.trim()).filter(Boolean) || []
    });
    onClose();
  }

  async function submitChat(event: FormEvent) {
    event.preventDefault();
    const value = chat.trim();
    if (!value) return;
    setChat("");
    await onSendAssistant(value, task?.id);
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
                  {["resumo", "aceite", "execucao", "worktree", "dependencias", "subtasks", "hooks", "eventos", "arquivos"].map((tab) => (
                    <Tabs.Trigger className="tabs-trigger" key={tab} value={tab}>{tab}</Tabs.Trigger>
                  ))}
                </Tabs.List>
                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <Tabs.Content value="resumo" className="space-y-3">
                    <label className="field">Título<input className="input" aria-label="Título" {...form.register("title")} /></label>
                    <label className="field">Descrição<textarea className="textarea" aria-label="Descrição" {...form.register("description")} /></label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="field">Tipo<input className="input" {...form.register("kind")} /></label>
                      <label className="field">Prioridade<input className="input" {...form.register("priority")} /></label>
                    </div>
                    <label className="field">Projetos alvo<input className="input" placeholder="repo-a, repo-b" {...form.register("projectTargets")} /></label>
                  </Tabs.Content>
                  <Tabs.Content value="aceite"><Panel title="Critérios de aceite" lines={["Definir aceite objetivo na descrição da task.", "Validar via testes e evidência antes de completar."]} /></Tabs.Content>
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
                  <Tabs.Content value="eventos"><Panel title="Timeline" lines={[`updated: ${task?.updatedAt || "nao persistida"}`]} /></Tabs.Content>
                  <Tabs.Content value="arquivos"><Panel title="Arquivos da task" lines={["task.yaml", "description.md", "acceptance.md", "dependencies.yaml", "events.jsonl"]} /></Tabs.Content>
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
              <form className="flex gap-2 border-t border-zinc-800 p-4" onSubmit={submitChat}>
                <input className="input" placeholder="Pergunte sobre escopo" value={chat} onChange={(event) => setChat(event.target.value)} />
                <button className="icon-button" aria-label="Enviar"><Send size={16} /></button>
              </form>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
