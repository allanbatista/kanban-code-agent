import { DragEvent, FormEvent, useRef, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Paperclip } from "lucide-react";
import type { ChatMessage } from "../types";

export function AssistantPanel({
  messages,
  onSend,
  taskCount,
  selectedTaskId
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<string> | string;
  taskCount: number;
  selectedTaskId?: string;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    const attachmentNote = attachments.length ? `\n\nAnexos: ${attachments.map((file) => file.name).join(", ")}` : "";
    setText("");
    setAttachments([]);
    await onSend(`${value}${attachmentNote}`);
  }

  function addAttachments(files: FileList | File[]) {
    const next = Array.from(files);
    setAttachments((current) => {
      const keys = new Set(current.map((file) => `${file.name}:${file.size}`));
      return [...current, ...next.filter((file) => !keys.has(`${file.name}:${file.size}`))];
    });
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addAttachments(event.dataTransfer.files);
  }

  return (
    <section aria-label="Assistant do board" className="side-panel chat-panel active">
      <header className="chat-head">
        <strong>Assistant do board</strong>
        <p>Gerencia o Kanban, explica bloqueios, cria tasks, decompõe features e conversa com o orchestrator.</p>
      </header>
      <div className="chat-tools">
        <div className="chat-meta">
          <span className="pill soft">{selectedTaskId || "Sem task selecionada"}</span>
          <span className="pill soft">{taskCount} tasks</span>
        </div>
        <div className="chat-suggestions">
          {["Por que não iniciou?", "Decompor master", "Worktrees", "Próxima ação"].map((prompt) => (
            <button key={prompt} type="button" onClick={() => setText(prompt)}>{prompt}</button>
          ))}
        </div>
      </div>
      <ScrollArea.Root className="chat-stream">
        <ScrollArea.Viewport className="h-full">
          <div className="chat-stream-inner">
            {messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <div className="chat-meta">{message.role.toUpperCase()} · {message.time}</div>
                <p className="chat-bubble">{message.text}</p>
              </article>
            ))}
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" />
      </ScrollArea.Root>
      <form className="chat-composer" onSubmit={submit}>
        <textarea
          placeholder="Peça ao agent principal para criar, mover, decompor, pausar, retomar ou explicar tasks."
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="chat-upload-row" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
          <button type="button" className="quiet" onClick={() => fileInputRef.current?.click()}><Paperclip size={15} />Anexar</button>
          <span>{attachments.length ? attachments.map((file) => file.name).join(", ") : "Solte arquivos aqui"}</span>
          <input ref={fileInputRef} className="sr-only" type="file" multiple onChange={(event) => event.target.files && addAttachments(event.target.files)} />
        </div>
        <div className="chat-composer-foot">
          <span>Daemon local · tools tipadas</span>
          <div className="chat-composer-actions">
            <button className="quiet" type="button" onClick={() => setText("")}>Limpar</button>
            <button className="primary" aria-label="Enviar">Enviar</button>
          </div>
        </div>
      </form>
    </section>
  );
}
