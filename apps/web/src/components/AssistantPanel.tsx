import { FormEvent, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    await onSend(value);
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
