import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { interruptRun, startRun } from "@kca/agent-runtime";
import { boardSnapshot, createTask, getTask, listTasks, moveTask, normalizeColumnId, paths, readAgent, readSettings, readSettingsScope, updateSettings, updateTask, writeTaskFile, appendJsonl } from "@kca/fsdb";
import { appendChatMessage, readChatHistory } from "@kca/fsdb/chat-store";
import { runBoardAssistant, loadPiSdk } from "@kca/pi-adapter";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";

function virtualAssistantTask(scope, prompt) {
  return {
    id: scope === "task" ? "TASK-ASSISTANT" : "BOARD-ASSISTANT",
    title: `${scope} assistant: ${String(prompt).slice(0, 80)}`,
    kind: "task",
    column: "manager",
    status: "running",
    priority: "medium",
    projectTargets: [],
    routing: { currentAgent: "assistant", manualOverride: { active: false } },
    worktree: { enabled: false, kind: "assistant", branch: "assistant", parentTaskId: null, mergeTarget: "main" },
    dependencies: { needs: [], provides: [], blockedBy: [], fileLocks: [], semaphores: [] },
    hooks: { active: [] },
    skills: { active: ["kanban-management"] }
  };
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function isCreateTaskRequest(value) {
  const lower = normalizeText(value);
  return (/\b(criar|crie|cria|nova|novo)\b/.test(lower) && /\b(task|tarefa)\b/.test(lower));
}

function stripCreateTaskCommand(value) {
  return String(value || "")
    .replace(/.*\b(?:criar|crie|cria|nova|novo)\b\s+(?:uma\s+|um\s+)?(?:task|tarefa)\b\s*(?:para\s+)?/i, "")
    .trim();
}

function isSubjectiveTaskPayload(value) {
  const lower = normalizeText(value).trim();
  return !lower || /\b(essa|esta|isso|isto|aquilo|algo|coisa|informacao)\b/.test(lower);
}

function inferTaskTitle(payload) {
  const clean = String(payload || "").replace(/\s+/g, " ").replace(/[.?!]+$/g, "").trim();
  if (!clean) return "";
  const words = clean.split(" ");
  if (words.length <= 8 && clean.length <= 80 && !/[.;:]/.test(clean)) return clean;
  return words.slice(0, 8).join(" ");
}

const LEGACY_ROLE_ALIASES = {
  architect: "architecture",
  engineer: "engineering",
  validator: "quality",
  reviewer: "review"
};

function canonicalRole(value, fallback = "engineering") {
  return LEGACY_ROLE_ALIASES[value] || value || fallback;
}

function createTaskInputFromPrompt(prompt, history) {
  if (!isCreateTaskRequest(prompt)) return null;
  const directPayload = stripCreateTaskCommand(prompt);
  const previousPayload = [...history].reverse().find((message) => message.role === "user" && message.text !== prompt && !isCreateTaskRequest(message.text))?.text || "";
  const payload = isSubjectiveTaskPayload(directPayload) ? previousPayload : directPayload;
  if (isSubjectiveTaskPayload(payload)) return { clarify: true };
  const title = inferTaskTitle(payload);
  const description = title === payload.replace(/[.?!]+$/g, "").trim() ? "" : payload.trim();
  return { title, description };
}

export async function agentChatWorkflow(command, root, whyNotRunning) {
  logStep("orchestrator", "agent.chat.start", { commandId: command.commandId, scope: command.scope, taskId: command.taskId || command.selectedTaskId || null });
  const agentId = command.agentId || "assistant";
  const prompt = String(command.prompt || "");
  const p = paths(root);
  const promptTaskId = prompt.match(/\bKCA-[A-Za-z0-9-]+\b/)?.[0];
  const chatTaskId = command.taskId || command.selectedTaskId || (command.scope === "task" ? promptTaskId : undefined);
  await appendChatMessage(root, { scope: command.scope, taskId: chatTaskId, role: "user", agentId, text: prompt, commandId: command.commandId });
  const history = await readChatHistory(root, { scope: command.scope, taskId: chatTaskId, persona: agentId, limit: 8 });
  const piLoaded = await loadPiSdk();
  const useRealAgent = piLoaded.ok && piLoaded.mode === "real";

  if (useRealAgent) {
    logStep("orchestrator", "agent.chat.real", { agentId, scope: command.scope });
    let instructions = "";
    try {
      const agentConfig = await readAgent(agentId, root);
      if (agentConfig?.instructionsPath) instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
    } catch { /* use default */ }

    const kanbanContext = {
      root,
      createTask: (input) => createTask(input, root),
      moveTask: (taskId, column) => moveTask(taskId, column, root),
      updateTask: (taskId, patch) => updateTask(taskId, patch, root, "task.updated"),
      getTask: (taskId) => getTask(taskId, root),
      listTasks: () => listTasks(root),
      boardSnapshot: () => boardSnapshot(root),
      whyNotRunning: (taskId) => whyNotRunning({ id: taskId }, root),
      decomposeTask: async (taskId, subtasks) => {
        const parent = await getTask(taskId, root);
        if (!parent) throw new Error(`Task not found: ${taskId}`);
        const created = [];
        for (let i = 0; i < (subtasks.length || 2); i++) {
          const def = subtasks[i] || { title: `${parent.title}: subtask ${i + 1}`, role: i === 0 ? "engineering" : "quality" };
          const role = canonicalRole(def.role || def.agent || def.agentId, i === 0 ? "engineering" : "quality");
          const task = await createTask({
            id: `${taskId}-${String(i + 1).padStart(2, "0")}`,
            title: def.title,
            kind: "subtask",
            column: "definition",
            status: "queued",
            projectTargets: parent.projectTargets || [],
            agent: role,
            role,
            worktree: { enabled: true, kind: "subtask", branch: `kca/${taskId}-${i + 1}`, pathRef: "worktree.yaml", parentTaskId: taskId, mergeTarget: parent.worktree?.branch || "main" },
            dependencies: { needs: def.needs || (i > 0 ? [`subtask:${taskId}:implementation`] : parent.dependencies?.needs || []), provides: def.provides || [`subtask:${taskId}:subtask-${i + 1}`], blockedBy: [], fileLocks: parent.dependencies?.fileLocks || [], semaphores: [] }
          }, root);
          created.push(task.id);
        }
        return { taskIds: created };
      },
      readSettingsScope: (scope) => readSettingsScope(scope, root),
      updateSettings: (scope, patch) => updateSettings(scope, patch, root),
      runTask: async (taskId, agentIdOverride) => {
        const task = await getTask(taskId, root);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        const run = await startRun(task, root, canonicalRole(agentIdOverride || task.routing?.currentAgent || "engineering"));
        return { agentId: run.agentId, runId: run.runId };
      },
      interruptTask: async (taskId, mode) => {
        const task = await getTask(taskId, root);
        if (!task) throw new Error(`Task not found: ${taskId}`);
        return interruptRun(task, root, mode);
      },
      orchestratorStatus: async () => {
        const tasks = await listTasks(root);
        const snapshot = await boardSnapshot(root);
        const settings = await readSettings(root);
        const running = tasks.filter(t => t.status === "running");
        const queued = tasks.filter(t => t.status === "queued");
        return {
          running: running.length,
          maxParallel: settings.runtime?.maxParallelTasks || 0,
          queued: queued.length,
          mergePending: tasks.filter(t => t.status === "merge_pending").length,
          activeWorktrees: tasks.filter(t => t.worktree?.enabled).length,
          agentsOnline: (snapshot.columns || []).filter(c => c.agent).length,
          locks: tasks.reduce((sum, t) => sum + (t.dependencies?.fileLocks?.length || 0), 0)
        };
      }
    };

    const recentChat = history.slice(-6).map((message) => `${message.role}: ${message.text}`).join("\n");
    const agentResult = await runBoardAssistant({ prompt: recentChat ? `Histórico recente:\n${recentChat}\n\nPedido atual:\n${prompt}` : prompt, agentId, instructions, root: p.root, context: kanbanContext });
    await appendJsonl(`${p.runtime}/logs/events.jsonl`, { ts: new Date().toISOString(), type: "agent.event", actor: agentId, scope: command.scope, taskId: command.selectedTaskId || command.taskId || null, prompt: command.prompt, reply: agentResult.reply, ok: agentResult.ok });
    await appendChatMessage(root, { scope: command.scope, taskId: chatTaskId, role: "assistant", agentId, text: agentResult.reply, commandId: command.commandId });
    return { ok: true, commandId: command.commandId, reply: agentResult.reply, agentOk: agentResult.ok };
  }

  logStep("orchestrator", "agent.chat.fallback", { agentId, scope: command.scope });
  const current = command.taskId || command.selectedTaskId || promptTaskId ? await getTask(command.taskId || command.selectedTaskId || promptTaskId, root) : null;
  const agentTask = current || virtualAssistantTask(command.scope, command.prompt);
  const run = await startRun(agentTask, root, command.agentId || "assistant", { scope: command.scope, role: command.agentId || "assistant" });
  const lower = normalizeText(command.prompt);
  let action = null;
  let reply = command.scope === "task" && current ? `Analisei ${current.id} com o agent ${run.agentId}.` : `Analisei o board com o agent ${run.agentId}.`;

  const createInput = createTaskInputFromPrompt(command.prompt, history);
  if (createInput) {
    if (createInput.clarify) {
      reply = "Qual informação a task deve buscar?";
    } else {
      const task = TaskSchema.parse(await createTask({ title: createInput.title, description: createInput.description, column: "manager", projectTargets: [] }, root));
      action = { type: "task.created", taskId: task.id, column: task.column };
      reply = `Criei ${task.id} em manager: ${task.title}`;
    }
  } else if ((lower.includes("mover") || lower.includes("mova")) && current) {
    const snapshot = await boardSnapshot(root);
    const target = snapshot.columns.find((column) => lower.includes(column.id.toLowerCase()) || lower.includes(String(column.label || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()))
      || snapshot.columns.find((column) => column.id === normalizeColumnId(lower.includes("build") ? "build" : lower.includes("definition") ? "definition" : lower.includes("validate") ? "validate" : lower.includes("blocked") ? "blocked" : ""));
    if (target) {
      const task = TaskSchema.parse(await moveTask(current.id, target.id, root));
      action = { type: "task.moved", taskId: task.id, column: target.id };
      reply = `Movi ${task.id} para ${target.label || target.id}.`;
    } else {
      reply = `Não encontrei a coluna de destino para ${current.id}.`;
    }
  } else if ((lower.includes("renomear") || lower.includes("titulo") || lower.includes("título")) && current) {
    const title = command.prompt.split(/para\s+/i).pop()?.trim();
    if (title && title !== command.prompt) {
      const task = TaskSchema.parse(await updateTask(current.id, { title }, root, "task.updated"));
      action = { type: "task.updated", taskId: task.id, fields: ["title"] };
      reply = `Atualizei ${task.id}: ${task.title}`;
    } else {
      reply = `Informe o novo título usando "renomear para ...".`;
    }
  } else if ((lower.includes("aceite") || lower.includes("criterio")) && current) {
    const acceptance = command.prompt.split(/para\s+/i).pop()?.trim() || command.prompt.trim();
    await writeTaskFile(current.id, "acceptance.md", `# Critérios de aceite\n\n- [ ] ${acceptance}\n`, root);
    action = { type: "acceptance.updated", taskId: current.id };
    reply = `Atualizei aceite de ${current.id}.`;
  } else if ((lower.includes("decompor") || lower.includes("decomponha") || lower.includes("subtask")) && current) {
    const first = TaskSchema.parse(await createTask({
      id: `${current.id}-01`,
      title: `${current.title}: implementação`,
      kind: "subtask",
      column: "definition",
      status: "queued",
      projectTargets: current.projectTargets,
      agent: "engineering",
      role: "engineering",
      worktree: { enabled: true, kind: "subtask", branch: `kca/${current.id}-1`, pathRef: "worktree.yaml", parentTaskId: current.id, mergeTarget: current.worktree?.branch || "main" },
      dependencies: { needs: current.dependencies?.needs || [], provides: [`subtask:${current.id}:implementation`], blockedBy: [], fileLocks: current.dependencies?.fileLocks || [], semaphores: [] }
    }, root));
    const second = TaskSchema.parse(await createTask({
      id: `${current.id}-02`,
      title: `${current.title}: validação`,
      kind: "subtask",
      column: "definition",
      status: "queued",
      projectTargets: current.projectTargets,
      agent: "quality",
      role: "quality",
      worktree: { enabled: true, kind: "subtask", branch: `kca/${current.id}-2`, pathRef: "worktree.yaml", parentTaskId: current.id, mergeTarget: current.worktree?.branch || "main" },
      dependencies: { needs: [`subtask:${current.id}:implementation`], provides: [`subtask:${current.id}:validation`], blockedBy: [], fileLocks: [], semaphores: [] }
    }, root));
    action = { type: "subtasks.spawned", taskIds: [first.id, second.id] };
    reply = `Decompus ${current.id} em ${first.id} e ${second.id}.`;
  } else if ((lower.includes("por que") || lower.includes("porque") || lower.includes("nao iniciou") || lower.includes("não iniciou")) && current) {
    const why = await whyNotRunning(current, root);
    action = { type: "why_not_running", taskId: current.id };
    reply = why.runnable ? `${current.id} está pronta para executar.` : `${current.id}: ${why.reasons.join(" ") || "sem bloqueios observáveis"}`;
  }

  await appendJsonl(`${p.runtime}/logs/events.jsonl`, { ts: new Date().toISOString(), type: "agent.event", actor: run.agentId, runId: run.runId, scope: command.scope, taskId: current?.id, prompt: command.prompt, reply, action });
  await appendChatMessage(root, { scope: command.scope, taskId: current?.id || chatTaskId, role: "assistant", agentId: run.agentId, text: reply, commandId: command.commandId, runId: run.runId });
  return { ok: true, commandId: command.commandId, run, reply, action };
}
