import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Plus, Settings, Sun } from "lucide-react";
import { commandDaemon, commandId, daemonWebSocketUrl, loadState, queryDaemon, queryOrchestrator } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Board } from "./components/Board";
import { SettingsDialog } from "./components/SettingsDialog";
import { TaskModal } from "./components/TaskModal";
import { OrchestratorPanel } from "./components/OrchestratorPanel";
import type { AgentLogPage, AgentSettings, ChatMessage, ProviderStatus, Task, TaskFiles } from "./types";

function now() {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function chatMessage(message: Record<string, unknown>): ChatMessage {
  return {
    id: String(message.id || commandId("chat")),
    role: message.role === "user" ? "user" : "assistant",
    persona: message.persona ? String(message.persona) : undefined,
    agentId: message.agentId ? String(message.agentId) : undefined,
    runId: message.runId ? String(message.runId) : undefined,
    disposition: message.disposition ? String(message.disposition) : undefined,
    time: message.ts ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(String(message.ts))) : now(),
    text: String(message.text || "")
  };
}

function invalidateRealtimeQueries(queryClient: ReturnType<typeof useQueryClient>, eventType?: string) {
  if (eventType === "connected" || eventType === "subscribed") return;
  void queryClient.invalidateQueries({ queryKey: ["state"] });
  void queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
  void queryClient.invalidateQueries({ queryKey: ["chat"] });
  void queryClient.invalidateQueries({ queryKey: ["comments"] });
  void queryClient.invalidateQueries({ queryKey: ["agent-logs"] });
  void queryClient.invalidateQueries({ queryKey: ["task-files"] });
  if (eventType === "fsdb.changed" || eventType === "command.result") {
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
    void queryClient.invalidateQueries({ queryKey: ["providers"] });
  }
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("file_read_failed"));
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });
}

function AppShell() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("kca-theme") || "light");
  const [rail, setRail] = useState<"chat" | "ops">("chat");
  const [extraLogPages, setExtraLogPages] = useState<AgentLogPage[]>([]);
  const [draftTask, setDraftTask] = useState<Task | null>(null);
  const selectedTaskId = params.get("task");
  const statusFilter = params.get("status") || "all";
  const search = params.get("q") || "";

  const state = useQuery({ queryKey: ["state"], queryFn: loadState });
  const orchestrator = useQuery({ queryKey: ["orchestrator"], queryFn: queryOrchestrator });
  const agents = useQuery({ queryKey: ["settings", "agents"], queryFn: () => queryDaemon<{ agents: AgentSettings[] }>({ type: "settings.scope", scope: "agents" }) });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => queryDaemon<{ providers: ProviderStatus[] }>({ type: "provider.discover" }) });
  const boardChat = useQuery({ queryKey: ["chat", "board"], queryFn: () => queryDaemon<Array<Record<string, unknown>>>({ type: "chat.history", scope: "board" }) });
  const tasks = state.data?.tasks || [];
  const columns = state.data?.columns || [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const taskComments = useQuery({
    queryKey: ["comments", "task", selectedTaskId],
    queryFn: () => queryDaemon<Array<Record<string, unknown>>>({ type: "task.comments", taskId: selectedTaskId }),
    enabled: Boolean(selectedTaskId && selectedTaskId !== "new")
  });
  const taskLogs = useQuery({
    queryKey: ["agent-logs", selectedTaskId],
    queryFn: () => queryDaemon<AgentLogPage>({ type: "agent.logs", taskId: selectedTaskId, limit: 50 }),
    enabled: Boolean(selectedTaskId && selectedTaskId !== "new"),
    refetchInterval: selectedTask?.status === "running" ? 1000 : false
  });
  const taskFiles = useQuery({
    queryKey: ["task-files", selectedTaskId],
    queryFn: () => queryDaemon<TaskFiles>({ type: "task.files", taskId: selectedTaskId }),
    enabled: Boolean(selectedTaskId && selectedTaskId !== "new")
  });
  const boardMessages = boardChat.data?.map(chatMessage) || [];
  const taskMessages = taskComments.data?.map(chatMessage) || [];
  const logPages = [taskLogs.data, ...extraLogPages].filter(Boolean) as AgentLogPage[];
  const taskLogItems = logPages.flatMap((page) => page.items || []).slice(0, 100);
  const latestLogPage = logPages.at(-1);
  const taskTextScale = state.data?.settings?.ui?.taskTextScale ?? 100;
  const taskFontFamily = state.data?.settings?.ui?.taskFontFamily || "sans-serif";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("kca-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--task-text-scale", String(taskTextScale / 100));
    document.documentElement.style.setProperty("--task-font-family", taskFontFamily === "serif" ? "var(--font-serif)" : "Arial, Helvetica, sans-serif");
  }, [taskTextScale, taskFontFamily]);

  useEffect(() => {
    setExtraLogPages([]);
    if (selectedTaskId !== "new") setDraftTask(null);
  }, [selectedTaskId]);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    function connect() {
      socket = new WebSocket(daemonWebSocketUrl());
      socket.onopen = () => {
        attempts = 0;
        socket?.send(JSON.stringify({ type: "subscribe", id: commandId("ws-subscribe"), topics: ["commands", "fsdb", "scheduler"] }));
        invalidateRealtimeQueries(queryClient);
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as { type?: string };
          invalidateRealtimeQueries(queryClient, event.type);
        } catch {
          invalidateRealtimeQueries(queryClient);
        }
      };
      socket.onclose = () => {
        if (closed) return;
        const delay = Math.min(1000 * 2 ** attempts, 10000);
        attempts += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === "all" || task.status === statusFilter || task.column === statusFilter;
      const term = search.trim().toLowerCase();
      const matchesSearch = !term || `${task.id} ${task.title} ${task.projectTargets.join(" ")}`.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [tasks, statusFilter, search]);

  const runCommand = useMutation<unknown, Error, Record<string, unknown>>({
    mutationFn: commandDaemon,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["state"] });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
    }
  });

  function patchParams(next: Record<string, string | null>) {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace: true });
  }

  async function sendAssistant(prompt: string, taskId?: string) {
    const clean = prompt.trim();
    if (!clean) return "";
    try {
      const payload = {
        type: "agent.chat",
        commandId: commandId("assistant-chat"),
        scope: taskId ? "task" : "board",
        agentId: "assistant",
        prompt: clean
      } as Record<string, unknown>;
      if (taskId) payload.taskId = taskId;
      if (selectedTaskId && selectedTaskId !== "new") payload.selectedTaskId = selectedTaskId;
      const result = await commandDaemon<{ reply?: string }>(payload);
      const reply = result.reply || "Comando processado.";
      await queryClient.invalidateQueries({ queryKey: ["state"] });
      await queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
      await queryClient.invalidateQueries({ queryKey: taskId ? ["chat", "task", taskId] : ["chat", "board"] });
      return reply;
    } catch (error) {
      const reply = `Erro do daemon: ${error instanceof Error ? error.message : String(error)}`;
      return reply;
    }
  }

  async function sendTaskComment(text: string, taskId: string) {
    const result = await commandDaemon<{ resumed?: boolean }>({ type: "task.comment", commandId: commandId("task-comment"), taskId, text });
    await queryClient.invalidateQueries({ queryKey: ["state"] });
    await queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
    await queryClient.invalidateQueries({ queryKey: ["comments", "task", taskId] });
    await queryClient.invalidateQueries({ queryKey: ["agent-logs", taskId] });
    return result.resumed ? "Resposta registrada. Task retomada automaticamente." : "Comentario registrado.";
  }

  async function loadMoreTaskLogs(taskId: string) {
    const cursor = latestLogPage?.nextCursor;
    if (!cursor) return null;
    const page = await queryDaemon<AgentLogPage>({ type: "agent.logs", taskId, limit: 50, cursor });
    setExtraLogPages((current) => {
      const pages = [...current, page];
      let count = taskLogs.data?.items?.length || 0;
      const kept: AgentLogPage[] = [];
      for (const item of pages) {
        if (count >= 100) break;
        kept.push({ ...item, items: (item.items || []).slice(0, Math.max(0, 100 - count)) });
        count += item.items?.length || 0;
      }
      return kept;
    });
    return page;
  }

  async function resetBoardChat() {
    await runCommand.mutateAsync({ type: "chat.reset_board", commandId: commandId("board-chat-reset"), agentId: "assistant" });
    await queryClient.invalidateQueries({ queryKey: ["chat", "board"] });
  }

  function fallbackTitle(input: { title?: string; description?: string }) {
    const title = String(input.title || "").trim();
    if (title) return title;
    const description = String(input.description || "").replace(/[#*_>`[\]()!-]/g, " ").split("\n").map((line) => line.trim()).find(Boolean);
    return (description || "Rascunho sem titulo").slice(0, 80);
  }

  async function writeDescription(taskId: string, title: string, description?: string) {
    await runCommand.mutateAsync({
      type: "task.file.write",
      commandId: commandId("task-description-write"),
      taskId,
      path: "description.md",
      content: `# ${title}\n\n${description || ""}\n`
    });
  }

  async function saveTask(input: { id?: string; title: string; description?: string; projectTargets: string[] }, options: { execute?: boolean } = {}) {
    const title = fallbackTitle(input);
    let task: Task;
    if (input.id) {
      const updated = await runCommand.mutateAsync({
        type: "task.update",
        commandId: commandId("task-update"),
        taskId: input.id,
        patch: {
          title,
          projectTargets: input.projectTargets
        }
      }) as { task: Task };
      task = updated.task;
      await writeDescription(task.id, title, input.description);
    } else {
      const created = await runCommand.mutateAsync({
        type: "task.create",
        commandId: commandId("task-create"),
        input: { ...input, title, column: "inbox", draft: true }
      }) as { task: Task };
      task = created.task;
    }
    setDraftTask(task.status === "draft" ? task : null);
    if (options.execute) {
      const moved = await runCommand.mutateAsync({ type: "task.move", commandId: commandId("task-move"), taskId: task.id, toColumn: "manager", mode: "soft" }) as { task: Task };
      task = moved.task;
      setDraftTask(null);
    }
    await queryClient.invalidateQueries({ queryKey: ["state"] });
    await queryClient.invalidateQueries({ queryKey: ["task-files", task.id] });
    return task;
  }

  async function uploadTaskAttachment(input: { id?: string; title: string; description?: string; projectTargets: string[] }, file: File) {
    const task = input.id ? { id: input.id } as Task : await saveTask(input, { execute: false }) as Task;
    const dataBase64 = await fileToBase64(file);
    const result = await runCommand.mutateAsync({
      type: "task.attachment.write",
      commandId: commandId("task-attachment-write"),
      taskId: task.id,
      fileName: file.name || `clipboard-${Date.now()}.png`,
      contentType: file.type || "application/octet-stream",
      dataBase64
    }) as { task: Task; path: string };
    setDraftTask((current) => current?.id === result.task.id ? current : result.task);
    await queryClient.invalidateQueries({ queryKey: ["task-files", task.id] });
    return result;
  }

  async function moveTask(taskId: string, columnId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (task?.column === columnId) return;
    if (task?.status === "running" && !window.confirm("Task em execução. Interromper/checkpoint antes de mover?")) return;
    await runCommand.mutateAsync({ type: "task.move", commandId: commandId("task-move"), taskId, toColumn: columnId, mode: "soft" });
  }

  async function taskAction(task: Task, action: "run" | "interrupt" | "complete" | "decompose") {
    if (action === "run") {
      await runCommand.mutateAsync({ type: "task.run", commandId: commandId("task-run"), taskId: task.id, agentId: task.routing?.currentAgent || "engineering" });
    }
    if (action === "interrupt") {
      await runCommand.mutateAsync({ type: "task.interrupt", commandId: commandId("task-interrupt"), taskId: task.id, mode: "soft" });
    }
    if (action === "complete") {
      const runId = typeof task.agent === "object" ? task.agent?.currentRunId : undefined;
      await runCommand.mutateAsync({ type: "agent.complete_task", commandId: commandId("task-complete"), taskId: task.id, runId: runId || `manual-${Date.now()}`, nextColumn: "done", summary: "Concluido pela UI." });
    }
    if (action === "decompose") {
      await runCommand.mutateAsync({ type: "task.decompose", commandId: commandId("task-decompose"), taskId: task.id });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Kanban Code Agent">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span className="brand-copy">
            <strong>Kanban Code Agent</strong>
            <span>Local-first agent orchestration</span>
          </span>
        </Link>
        <div className="top-actions">
          <button className="quiet" type="button" onClick={() => setSettingsOpen(true)}><Settings size={16} />Configurações</button>
          <button className="quiet" type="button" onClick={() => { setDraftTask(null); patchParams({ task: "new" }); }}><Plus size={16} />Nova task</button>
          <button className="icon-button quiet" aria-label="Alternar tema" title="Alternar tema" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>

      <main className="workspace">
        <section className="board-shell" aria-label="Board">
          <Board
            columns={columns}
            tasks={filteredTasks}
            loading={state.isLoading}
            statusFilter={statusFilter}
            search={search}
            onFilter={(value) => patchParams({ status: value === "all" ? null : value })}
            onSearch={(value) => patchParams({ q: value || null })}
            onOpenTask={(taskId) => patchParams({ task: taskId })}
            onNewTask={(columnId) => { setDraftTask(null); patchParams({ task: "new", column: columnId }); }}
            onMoveTask={moveTask}
          />
        </section>
        <aside className="right-rail" aria-label="Painel lateral">
          <div className="rail-tabs">
            <button className={rail === "chat" ? "active" : ""} type="button" onClick={() => setRail("chat")}>Assistant</button>
            <button className={rail === "ops" ? "active" : ""} type="button" onClick={() => setRail("ops")}>Orchestrator</button>
          </div>
          {rail === "chat" ? <AssistantPanel messages={boardMessages} onSend={(text) => sendAssistant(text)} onNewChat={resetBoardChat} /> : null}
          {rail === "ops" ? <OrchestratorPanel status={orchestrator.data} loading={orchestrator.isLoading} /> : null}
        </aside>
      </main>

      <TaskModal
        task={selectedTaskId === "new" ? null : selectedTask}
        draftTask={draftTask}
        open={Boolean(selectedTaskId)}
        onClose={() => { setDraftTask(null); patchParams({ task: null, column: null }); }}
        onSave={saveTask}
        onUploadAttachment={uploadTaskAttachment}
        onSendComment={sendTaskComment}
        messages={taskMessages}
        logs={taskLogItems}
        logsHasMore={Boolean(latestLogPage?.hasMore)}
        logsLoading={taskLogs.isLoading}
        onLoadMoreLogs={loadMoreTaskLogs}
        allTasks={tasks}
        files={taskFiles.data}
        onSaveFile={(taskId, path, content) => runCommand.mutateAsync({ type: "task.file.write", commandId: commandId("task-file-write"), taskId, path, content }).then(() => queryClient.invalidateQueries({ queryKey: ["task-files", taskId] }))}
        onAction={taskAction}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={state.data?.settings}
        agents={agents.data?.agents || []}
        providers={providers.data?.providers || []}
        onOpenChange={setSettingsOpen}
        onSave={(patch) => runCommand.mutateAsync({ type: "settings.update", commandId: commandId("settings-update"), scope: "app", patch })}
        onSaveAgent={(patch) => runCommand.mutateAsync({ type: "settings.update", commandId: commandId("agent-settings-update"), scope: "agents", patch }).then(() => queryClient.invalidateQueries({ queryKey: ["settings", "agents"] }))}
      />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<AppShell />} />
    </Routes>
  );
}
