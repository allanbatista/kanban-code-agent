import { DragEvent, FormEvent, useMemo, useRef, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { MessageSquarePlus, Paperclip } from "lucide-react";
import { ChatMessageContent } from "./ChatMessageContent";
import type { ChatMessage } from "../types";

type LocalChatMessage = ChatMessage & { pending?: boolean };

export function AssistantPanel({
  messages,
  onSend,
  onNewChat
}: {
  messages: ChatMessage[];
  onSend: (text: string) => Promise<string> | string;
  onNewChat: () => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [pendingMessages, setPendingMessages] = useState<LocalChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visibleMessages = useMemo(() => {
    const persisted = new Set(messages.map((message) => `${message.role}:${message.text}`));
    return [...messages, ...pendingMessages.filter((message) => !persisted.has(`${message.role}:${message.text}`))] as LocalChatMessage[];
  }, [messages, pendingMessages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    const attachmentNote = attachments.length ? `\n\nAnexos: ${attachments.map((file) => file.name).join(", ")}` : "";
    const prompt = `${value}${attachmentNote}`;
    const userMessage: LocalChatMessage = { id: `local-user-${Date.now()}`, role: "user", time: "agora", text: prompt };
    const thinkingMessage: LocalChatMessage = { id: `local-thinking-${Date.now()}`, role: "assistant", time: "agora", text: "Pensando...", pending: true };
    setText("");
    setAttachments([]);
    setSending(true);
    setPendingMessages((current) => [...current, userMessage, thinkingMessage]);
    try {
      const reply = await onSend(prompt);
      setPendingMessages((current) => current.map((message) => message.id === thinkingMessage.id ? { ...message, text: reply || "Comando processado.", pending: false } : message));
    } catch (error) {
      const reply = `Erro do daemon: ${error instanceof Error ? error.message : String(error)}`;
      setPendingMessages((current) => current.map((message) => message.id === thinkingMessage.id ? { ...message, text: reply, pending: false } : message));
    } finally {
      setSending(false);
    }
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

  async function startNewChat() {
    if (sending) return;
    setText("");
    setAttachments([]);
    setPendingMessages([]);
    await onNewChat();
  }

  return (
    <section aria-label="Assistant do board" className="side-panel chat-panel active">
      <header className="chat-head">
        <strong>Assistant do board</strong>
        <button className="icon-button quiet" type="button" aria-label="Novo chat" title="Novo chat" disabled={sending} onClick={() => void startNewChat()}>
          <MessageSquarePlus size={16} />
        </button>
      </header>
      <ScrollArea.Root className="chat-stream">
        <ScrollArea.Viewport className="h-full">
          <div className="chat-stream-inner">
            {visibleMessages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <div className="chat-meta">{message.role.toUpperCase()} · {message.time}</div>
                <ChatMessageContent className="chat-bubble" text={message.text} pending={message.pending} spinnerSize={15} />
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
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="chat-upload-row" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
          <button type="button" className="quiet" disabled={sending} onClick={() => fileInputRef.current?.click()}><Paperclip size={15} />Anexar</button>
          <span>{attachments.length ? attachments.map((file) => file.name).join(", ") : "Solte arquivos aqui"}</span>
          <input ref={fileInputRef} className="sr-only" type="file" multiple disabled={sending} onChange={(event) => event.target.files && addAttachments(event.target.files)} />
        </div>
        <div className="chat-composer-foot">
          <span>Daemon local · tools tipadas</span>
          <div className="chat-composer-actions">
            <button className="quiet" type="button" disabled={sending} onClick={() => setText("")}>Limpar</button>
            <button className="primary" aria-label="Enviar" disabled={sending}>{sending ? "Pensando" : "Enviar"}</button>
          </div>
        </div>
      </form>
    </section>
  );
}
