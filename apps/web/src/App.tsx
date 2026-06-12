import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Plus, Settings, Sun } from "lucide-react";
import { commandDaemon, commandId, daemonBase, loadState, queryDaemon, queryOrchestrator } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Board } from "./components/Board";
import { SettingsDialog } from "./components/SettingsDialog";
import { TaskModal } from "./components/TaskModal";
import { OrchestratorPanel } from "./components/OrchestratorPanel";
import type { AgentSettings, ChatMessage, ProviderStatus, Task, TaskFiles } from "./types";

function now() {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function chatMessage(message: Record<string, unknown>): ChatMessage {
  return {
    id: String(message.id || commandId("chat")),
    role: message.role === "user" ? "user" : "assistant",
    time: message.ts ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(String(message.ts))) : now(),
    text: String(message.text || "")
  };
}

function AppShell() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("kca-theme") || "light");
  const [rail, setRail] = useState<"chat" | "ops">("chat");
  const selectedTaskId = params.get("task");
  const newTaskColumn = params.get("column") || "inbox";
  const statusFilter = params.get("status") || "all";
  const search = params.get("q") || "";

  const state = useQuery({ queryKey: ["state"], queryFn: loadState });
  const orchestrator = useQuery({ queryKey: ["orchestrator"], queryFn: queryOrchestrator });
  const agents = useQuery({ queryKey: ["settings", "agents"], queryFn: () => queryDaemon<{ agents: AgentSettings[] }>({ type: "settings.scope", scope: "agents" }) });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => queryDaemon<{ providers: ProviderStatus[] }>({ type: "provider.discover" }) });
  const boardChat = useQuery({ queryKey: ["chat", "board"], queryFn: () => queryDaemon<Array<Record<string, unknown>>>({ type: "chat.history", scope: "board" }) });
  const taskChat = useQuery({
    queryKey: ["chat", "task", selectedTaskId],
    queryFn: () => queryDaemon<Array<Record<string, unknown>>>({ type: "chat.history", scope: "task", taskId: selectedTaskId }),
    enabled: Boolean(selectedTaskId && selectedTaskId !== "new")
  });
  const taskFiles = useQuery({
    queryKey: ["task-files", selectedTaskId],
    queryFn: () => queryDaemon<TaskFiles>({ type: "task.files", taskId: selectedTaskId }),
    enabled: Boolean(selectedTaskId && selectedTaskId !== "new")
  });
  const tasks = state.data?.tasks || [];
  const columns = state.data?.columns || [];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const boardMessages = (boardChat.data?.length ? boardChat.data.map(chatMessage) : [{ id: "welcome", role: "assistant" as const, time: now(), text: "Olá. Posso gerenciar o Kanban, explicar por que uma task não iniciou, decompor uma master task em subtasks paralelas, ou acionar o orchestrator." }]);
  const taskMessages = taskChat.data?.map(chatMessage) || [];
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
    const source = new EventSource(`${daemonBase}/api/events`);
    source.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["state"] });
      void queryClient.invalidateQueries({ queryKey: ["orchestrator"] });
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    };
    source.onerror = () => source.close();
    return () => source.close();
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

  async function saveTask(input: { id?: string; title: string; description?: string; priority: string; kind: string; projectTargets: string[] }) {
    if (input.id) {
      await runCommand.mutateAsync({
        type: "task.update",
        commandId: commandId("task-update"),
        taskId: input.id,
        patch: {
          title: input.title,
          priority: input.priority,
          kind: input.kind,
          projectTargets: input.projectTargets
        }
      });
      return;
    }
    await runCommand.mutateAsync({
      type: "task.create",
      commandId: commandId("task-create"),
      input: { ...input, column: newTaskColumn }
    });
  }

  async function moveTask(taskId: string, columnId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (task?.status === "running" && !window.confirm("Task em execução. Interromper/checkpoint antes de mover?")) return;
    await runCommand.mutateAsync({ type: "task.move", commandId: commandId("task-move"), taskId, toColumn: columnId, mode: "soft" });
  }

  async function taskAction(task: Task, action: "run" | "interrupt" | "complete" | "decompose") {
    if (action === "run") {
      await runCommand.mutateAsync({ type: "task.run", commandId: commandId("task-run"), taskId: task.id, agentId: task.routing?.currentAgent || "engineer" });
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
          <button className="quiet" type="button" onClick={() => patchParams({ task: "new" })}><Plus size={16} />Nova task</button>
          <button className="icon-button quiet" aria-label="Alternar tema" title="Alternar tema" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
      </header>

      <main className="workspace">
        <section className="min-w-0" aria-label="Board">
          <Board
            columns={columns}
            tasks={filteredTasks}
            loading={state.isLoading}
            statusFilter={statusFilter}
            search={search}
            onFilter={(value) => patchParams({ status: value === "all" ? null : value })}
            onSearch={(value) => patchParams({ q: value || null })}
            onOpenTask={(taskId) => patchParams({ task: taskId })}
            onNewTask={(columnId) => patchParams({ task: "new", column: columnId })}
            onMoveTask={moveTask}
          />
        </section>
        <aside className="right-rail" aria-label="Painel lateral">
          <div className="rail-tabs">
            <button className={rail === "chat" ? "active" : ""} type="button" onClick={() => setRail("chat")}>Assistant</button>
            <button className={rail === "ops" ? "active" : ""} type="button" onClick={() => setRail("ops")}>Orchestrator</button>
          </div>
          {rail === "chat" ? <AssistantPanel messages={boardMessages} onSend={(text) => sendAssistant(text)} taskCount={tasks.length} selectedTaskId={selectedTask?.id} /> : null}
          {rail === "ops" ? <OrchestratorPanel status={orchestrator.data} loading={orchestrator.isLoading} /> : null}
        </aside>
      </main>

      <TaskModal
        task={selectedTaskId === "new" ? null : selectedTask}
        open={Boolean(selectedTaskId)}
        onClose={() => patchParams({ task: null, column: null })}
        onSave={saveTask}
        onSendAssistant={sendAssistant}
        messages={taskMessages}
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
