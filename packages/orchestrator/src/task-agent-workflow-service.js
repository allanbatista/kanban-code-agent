import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { interruptRun, startRun, writeRunSummary } from "@kca/agent-runtime";
import { createWorktree } from "@kca/git-worktree";
import { appendJsonl, boardSnapshot, getTask, listTasks, normalizeColumnId, paths, readJsonl, readProject, readSettings, updateTask, writeTaskFile } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { TaskSchema } from "@kca/schemas";
import { logStep } from "@kca/core/log";
import { roleById } from "@kca/core/roles";
import { discoverProviders } from "@kca/core/providers";
import { phaseForRole, requestDoneReview } from "./spec-workflow-service.js";

const exec = promisify(execFile);
const ROOT_TASK_ARTIFACTS = new Set(["acceptance.md"]);
const GENERATED_TITLE_PLACEHOLDERS = new Set(["rascunho sem titulo", "task sem titulo", "nova task", "aguardando detalhes da tarefa"]);

function roleColumn(roleId) {
  if (roleId === "done") return "done";
  return roleById(roleId)?.columnIds?.[0] || normalizeColumnId(roleId);
}

function assertActiveRun(task, runId) {
  if (!runId) return;
  if (task.agent?.currentRunId && task.agent.currentRunId !== runId) throw new Error("run_mismatch");
  if (task.routing?.manualOverride?.active && task.routing.manualOverride.invalidatesRunId === runId) throw new Error("manual_override_active");
}

async function routeProblemToManager(task, root, message, eventType = "task.problem") {
  await appendChatMessage(root, { scope: "task", taskId: task.id, role: "assistant", persona: "manager", agentId: "manager", disposition: eventType, text: message, visibility: "both" });
  return TaskSchema.parse(await updateTask(task.id, {
    status: "queued",
    column: "manager",
    routing: { ...task.routing, lastAgent: task.routing?.currentAgent || null, lastRole: task.routing?.currentRole || null, currentAgent: "manager", currentRole: "manager" },
    dependencies: { ...task.dependencies, blockedBy: [] }
  }, root, eventType));
}

async function failTaskPreservingRouting(task, root, message, eventType = "agent.failed") {
  const persona = task.routing?.currentRole || task.routing?.currentAgent || "assistant";
  const agentId = task.routing?.currentAgent || persona;
  await appendChatMessage(root, { scope: "task", taskId: task.id, role: "assistant", persona, agentId, disposition: eventType, text: message, visibility: "both" });
  return TaskSchema.parse(await updateTask(task.id, {
    status: "failed",
    column: task.column,
    routing: task.routing,
    dependencies: { ...task.dependencies, blockedBy: [] }
  }, root, eventType));
}

async function deferredCommentsForRun(root, taskId, runId) {
  if (!runId) return [];
  const events = await readJsonl(`${paths(root).tasks}/${taskId}/events.jsonl`);
  return events.filter((event) => event.type === "task.comment" && event.deferredForRunId === runId);
}

function normalizeTitleText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function descriptionBody(description, title) {
  const lines = String(description || "").split("\n");
  const first = lines[0]?.match(/^#\s+(.+?)\s*$/)?.[1];
  if (first && normalizeTitleText(first) === normalizeTitleText(title)) return lines.slice(1).join("\n").trim();
  return String(description || "").trim();
}

function fallbackTitleFromDescription(description) {
  return String(description || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`[\]()!-]/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)?.slice(0, 80) || "";
}

function shouldGenerateTitle(task, description) {
  const title = String(task.title || "").trim();
  if (!title) return true;
  if (GENERATED_TITLE_PLACEHOLDERS.has(normalizeTitleText(title))) return true;
  return Boolean(description && title === fallbackTitleFromDescription(descriptionBody(description, title)));
}

function cleanGeneratedTitle(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.replace(/^["'`]+|["'`.]+$/g, "").trim())
    .find(Boolean)?.slice(0, 80) || "";
}

const SYSTEM_PROMPT_TITLE_GENERATOR = `Você é um gerador de títulos curtos para tasks.

Sua função é criar um título claro, específico e útil com base no contexto da task fornecida.

Regras obrigatórias:
- Responda somente com o título
- Não use aspas
- Não use pontuação final
- Não use emojis
- Não escreva explicações
- Não use palavras genéricas como "Task", "Tarefa", "Atividade" ou "Ajustes" quando houver contexto melhor
- O título deve ter preferencialmente entre 3 e 12 palavras
- Use verbo de ação quando fizer sentido
- Preserve termos técnicos, nomes de features, IDs ou entidades importantes quando forem essenciais
- O título deve refletir o objetivo principal da task, não detalhes secundários
- Use o mesmo idioma predominante da task

Priorize títulos objetivos, específicos e fáceis de identificar em uma lista ou kanban.`;

async function requestGeneratedTitle(task, root, description) {
  const settings = await readSettings(root);
  const discovery = discoverProviders(settings);
  const provider = discovery.providers.find((item) => item.id === discovery.defaultProvider && item.active);
  const model = discovery.defaultModel || provider?.defaultModel;
  if (!provider || !model || !globalThis.fetch) return null;
  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : null;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (process.env.OPENROUTER_HTTP_REFERER) headers["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
  if (process.env.OPENROUTER_APP_TITLE) headers["X-Title"] = process.env.OPENROUTER_APP_TITLE;
  const response = await globalThis.fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_TITLE_GENERATOR},
        { role: "user", content: `Descricao da task:\n${descriptionBody(description, task.title).slice(0, 4000)}` }
      ]
    })
  });
  if (!response.ok) return null;
  const data = await response.json();
  return cleanGeneratedTitle(data?.choices?.[0]?.message?.content);
}

async function ensureTaskTitleBeforeRun(task, root) {
  let description = "";
  try {
    description = await readFile(`${paths(root).tasks}/${task.id}/description.md`, "utf8");
  } catch {}
  if (!shouldGenerateTitle(task, description)) return task;
  const title = await requestGeneratedTitle(task, root, description);
  const event = { ts: new Date().toISOString(), type: "task.title.generated", actor: "orchestrator", taskId: task.id, previousTitle: task.title, title: title || null };
  await appendJsonl(`${paths(root).tasks}/${task.id}/events.jsonl`, event);
  return title ? TaskSchema.parse(await updateTask(task.id, { title }, root, "task.title.generated")) : task;
}

async function requeueWaitingParentForChild(child, root, summary) {
  const parentTaskId = child.worktree?.parentTaskId;
  if (!parentTaskId) return null;
  const parent = await getTask(parentTaskId, root);
  if (!parent || parent.status !== "waiting") return null;
  const directChildren = (await listTasks(root)).filter((task) => task.worktree?.parentTaskId === parentTaskId);
  const completed = directChildren.filter((task) => task.status === "done").map((task) => task.id);
  const pending = directChildren.filter((task) => task.status !== "done").map((task) => task.id);
  const finalInstruction = pending.length
    ? ""
    : " Todas as subtasks diretas esperadas terminaram; nao solicite input, nao crie subtasks, consolide os resultados reportados e chame complete_task com nextColumn done.";
  const text = `Subtask concluida: ${child.id}. Concluidas: ${completed.join(", ") || "nenhuma"}. Pendentes: ${pending.join(", ") || "nenhuma"}. Resultado: ${summary || "sem resumo"}.${finalInstruction}`;
  await appendChatMessage(root, { scope: "task", taskId: parentTaskId, role: "assistant", persona: "orchestrator", agentId: "orchestrator", disposition: "subtask.result_reported", text, visibility: "both" });
  await appendJsonl(`${paths(root).tasks}/${child.id}/events.jsonl`, { ts: new Date().toISOString(), type: "subtask.result_reported", actor: "orchestrator", taskId: child.id, parentTaskId, summary });
  await appendJsonl(`${paths(root).tasks}/${parentTaskId}/events.jsonl`, { ts: new Date().toISOString(), type: "subtask.parent_requeued", actor: "orchestrator", taskId: parentTaskId, subtaskId: child.id, completed, pending });
  if (pending.length) return null;
  return TaskSchema.parse(await updateTask(parentTaskId, { status: "queued", column: parent.column, routing: parent.routing }, root, "subtask.parent_requeued"));
}

async function childResultSummary(child, root) {
  const events = await readJsonl(`${paths(root).tasks}/${child.id}/events.jsonl`);
  const reported = events.findLast?.((event) => event.type === "subtask.result_reported" && event.summary)
    || [...events].reverse().find((event) => event.type === "subtask.result_reported" && event.summary);
  return reported?.summary || "sem resumo reportado";
}

export async function runTaskWorkflow(command, root, whyNotRunning, executeCommand) {
  logStep("orchestrator", "task.run.start", { commandId: command.commandId, taskId: command.taskId });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  const why = await whyNotRunning(current, root);
  if (!why.runnable) {
    logStep("orchestrator", "task.run.blocked", { taskId: command.taskId, reasons: why.reasons });
    const task = current.status === "done"
      ? TaskSchema.parse(current)
      : TaskSchema.parse(await updateTask(command.taskId, { status: "queued" }, root, "agent.queued"));
    return { ok: false, commandId: command.commandId, task, why };
  }
  logStep("orchestrator", "task.run.launch", { taskId: command.taskId, agentId: command.agentId });
  let runnableTask = current;
  if (current.worktree?.enabled && !current.worktree.path) {
    const project = current.projectTargets?.[0] ? await readProject(current.projectTargets[0], root) : null;
    if (project?.repoPath) {
      const worktree = await createWorktree({ repoPath: project.repoPath, taskId: current.id, branch: current.worktree.branch, root: `${paths(root).runtime}/worktrees` });
      if (worktree.ok) {
        await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, { ts: new Date().toISOString(), type: "worktree.created", actor: "orchestrator", taskId: current.id, path: worktree.worktreePath, branch: worktree.branch });
        runnableTask = await updateTask(current.id, { worktree: { ...current.worktree, path: worktree.worktreePath, repoPath: project.repoPath } }, root, "worktree.updated");
      }
    } else if (project && !project.repoPath) {
      const reason = `Project ${project.id} has no repoPath configured.`;
      const task = await failTaskPreservingRouting(current, root, reason, "agent.failed");
      await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, { ts: new Date().toISOString(), type: "task.run.blocked", actor: "orchestrator", taskId: current.id, reason });
      return { ok: false, commandId: command.commandId, task, why: { runnable: false, reasons: [reason] } };
    }
  }
  runnableTask = await ensureTaskTitleBeforeRun(runnableTask, root);
  const run = await startRun(runnableTask, root, command.agentId, {
    executeCommand: (toolCommand) => executeCommand(toolCommand, root),
    beforePrompt: ({ runId, sessionRef, summaryRef, agentId, role }) => updateTask(command.taskId, {
      status: "running",
      routing: { ...runnableTask.routing, currentAgent: agentId, currentRole: role || runnableTask.routing?.currentRole || agentId },
      agent: { currentRunId: runId, currentSessionRef: sessionRef, resumeMode: "continue", lastSummary: summaryRef }
    }, root, "agent.started")
  });
  if (run.adapter?.promptSent === false || ["session_timeout", "prompt_timeout"].includes(run.adapter?.reason)) {
    const reason = run.adapter.reason || "prompt_not_sent";
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "failed",
      agent: { currentRunId: run.runId, currentSessionRef: run.sessionRef, resumeMode: "continue", lastSummary: run.summaryRef }
    }, root, "agent.failed"));
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.failed", actor: "orchestrator", taskId: command.taskId, runId: run.runId, reason });
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: false, commandId: command.commandId, task, run, reason };
  }
  if (run.adapter?.promptSent && run.adapter?.terminal === false && ["non_terminal_response", "max_turns_without_terminal"].includes(run.adapter?.reason)) {
    const reason = `Agent exited without a terminal tool call: ${run.adapter.reason}.`;
    const latestBeforeRecovery = await getTask(command.taskId, root) || runnableTask;
    const task = await failTaskPreservingRouting(latestBeforeRecovery, root, reason, "agent.non_terminal_exit");
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.non_terminal_exit", actor: "orchestrator", taskId: command.taskId, runId: run.runId, reason: run.adapter.reason });
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: false, commandId: command.commandId, task, run, reason };
  }
  const latest = await getTask(command.taskId, root);
  if (latest && (latest.status !== runnableTask.status || latest.column !== runnableTask.column || latest.updatedAt !== runnableTask.updatedAt)) {
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      routing: latest.column === "human_wait"
        ? latest.routing
        : { ...latest.routing, currentAgent: latest.routing?.currentAgent || run.agentId, currentRole: latest.routing?.currentRole || run.role || run.agentId },
      agent: { ...latest.agent, currentRunId: run.runId, currentSessionRef: run.sessionRef, resumeMode: "continue", lastSummary: latest.agent?.lastSummary || run.summaryRef }
    }, root, "agent.run_recorded"));
    logStep("orchestrator", "task.run.tool_mutated", { taskId: command.taskId, runId: run.runId, status: task.status, column: task.column });
    return { ok: true, commandId: command.commandId, task, run };
  }
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "running",
    routing: { ...runnableTask.routing, currentAgent: run.agentId, currentRole: run.role || runnableTask.routing?.currentRole || run.agentId },
    agent: { currentRunId: run.runId, currentSessionRef: run.sessionRef, resumeMode: "continue", lastSummary: run.summaryRef }
  }, root, "agent.started"));
  logStep("orchestrator", "task.run.done", { taskId: command.taskId, runId: run.runId });
  return { ok: true, commandId: command.commandId, task, run };
}

export async function interruptTaskWorkflow(command, root) {
  logStep("orchestrator", "task.interrupt", { commandId: command.commandId, taskId: command.taskId, mode: command.mode });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  const event = await interruptRun(current, root, command.mode);
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: command.mode === "hard" ? "idle" : "interrupting",
    routing: { ...current.routing, manualOverride: { active: true, lastManualMoveAt: event.ts, invalidatesRunId: current.agent?.currentRunId || null } }
  }, root, "agent.interrupted"));
  return { ok: true, commandId: command.commandId, task, event };
}

export async function completeTaskWorkflow(command, root) {
  logStep("orchestrator", "agent.complete_task", { commandId: command.commandId, taskId: command.taskId, runId: command.runId });
  logStep("agent", "task.complete", { taskId: command.taskId, runId: command.runId, nextColumn: command.nextColumn });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  assertActiveRun(current, command.runId);
  const summaryRef = await writeRunSummary(current, root, command.runId, command.summary);
  const visibleText = String(command.finalText || "").trim() || command.summary || "Task concluida pelo agent.";
  const deferredComments = await deferredCommentsForRun(root, command.taskId, command.runId);
  if (deferredComments.length) {
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "queued",
      column: current.column,
      routing: { ...current.routing, currentAgent: current.routing?.currentAgent || current.agent?.currentAgent || "manager", currentRole: current.routing?.currentRole || current.routing?.currentAgent || "manager" },
      agent: { ...current.agent, lastSummary: summaryRef }
    }, root, "agent.completed"));
    await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: current.routing?.currentRole || current.routing?.currentAgent || "assistant", agentId: current.routing?.currentAgent || "assistant", runId: command.runId, disposition: "agent.completed_pending_comment", text: visibleText, visibility: "both" });
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task, summaryRef, deferredComments: deferredComments.length };
  }
  const requestedColumn = normalizeColumnId(command.nextColumn);
  const nextColumn = requestedColumn;
  const target = (await boardSnapshot(root)).columns.find((column) => column.id === nextColumn);
  const done = nextColumn === "done";
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: done ? "done" : "queued",
    column: nextColumn,
    routing: {
      ...current.routing,
      lastAgent: current.routing?.currentAgent || null,
      lastRole: current.routing?.currentRole || null,
      currentAgent: done ? null : target?.agent || current.routing?.currentAgent,
      currentRole: done ? null : target?.role || target?.agent || current.routing?.currentRole
    },
    agent: { ...current.agent, lastSummary: summaryRef },
    workflow: { ...current.workflow, phase: done ? "done" : phaseForRole(target?.role || target?.agent || current.routing?.currentRole || "manager"), currentRole: done ? "none" : target?.role || target?.agent || current.routing?.currentRole || "manager", boardColumn: nextColumn }
  }, root, "agent.completed"));
  await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: current.routing?.currentRole || current.routing?.currentAgent || "assistant", agentId: current.routing?.currentAgent || "assistant", runId: command.runId, disposition: "agent.completed", text: visibleText, visibility: "both" });
  const parentTask = await requeueWaitingParentForChild(task, root, command.summary || visibleText);
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task, summaryRef, parentTask };
}

export async function reportBlockerWorkflow(command, root) {
  logStep("orchestrator", "agent.report_blocker", { commandId: command.commandId, taskId: command.taskId, blocker: command.blocker });
  logStep("agent", "task.blocker", { taskId: command.taskId, runId: command.runId, blocker: command.blocker });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  assertActiveRun(current, command.runId);
  const task = await routeProblemToManager(current, root, command.blocker, "task.problem");
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: true, commandId: command.commandId, task };
}

export async function requestUserInputWorkflow(command, root) {
  logStep("orchestrator", "agent.request_user_input", { commandId: command.commandId, taskId: command.taskId });
  logStep("agent", "wait.human", { taskId: command.taskId, runId: command.runId, question: command.question });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  assertActiveRun(current, command.runId);
  const directChildren = (await listTasks(root)).filter((task) => task.worktree?.parentTaskId === command.taskId);
  if (directChildren.length && directChildren.every((task) => task.status === "done")) {
    const childSummaries = await Promise.all(directChildren
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(async (child) => `- ${child.id} (${child.title}): ${await childResultSummary(child, root)}`));
    const summary = [
      `Consolidacao final: todas as ${directChildren.length} subtasks diretas estao done.`,
      ...childSummaries,
      `Completando o parent sem solicitar input humano. Pergunta ignorada: ${command.question}`
    ].join("\n");
    await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: "orchestrator", agentId: "orchestrator", runId: command.runId, disposition: "subtasks.completed_parent_done", text: summary, visibility: "both" });
    const task = await requestDoneReview(current, root, { runId: command.runId, summary, source: "subtasks.completed_parent_done" });
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "subtasks.completed_parent_done", actor: "orchestrator", taskId: command.taskId, ignoredQuestion: command.question, subtasks: directChildren.map((task) => task.id) });
    return { ok: true, commandId: command.commandId, task, summary };
  }
  const relativePath = `summaries/input-${Date.now()}.md`;
  await writeTaskFile(command.taskId, relativePath, `# Input solicitado\n\n${command.question}\n`, root);
  const requester = current.routing?.currentRole || current.routing?.currentAgent || "assistant";
  const message = await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: requester, agentId: current.routing?.currentAgent || requester, runId: command.runId, disposition: "wait_for_human", text: command.question, visibility: "both" });
  const task = TaskSchema.parse(await updateTask(command.taskId, {
    status: "idle",
    column: "human_wait",
    routing: { ...current.routing, lastAgent: current.routing?.currentAgent || null, lastRole: requester, currentAgent: null, currentRole: null },
    dependencies: { ...current.dependencies, blockedBy: [] }
  }, root, "agent.input_requested"));
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "human.input_requested", actor: requester, taskId: command.taskId, inputPath: relativePath, messageId: message.id });
  return { ok: true, commandId: command.commandId, task, inputPath: relativePath, message };
}

export async function emitArtifactWorkflow(command, root) {
  logStep("orchestrator", "agent.emit_artifact", { commandId: command.commandId, taskId: command.taskId, path: command.path });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  assertActiveRun(current, command.runId);
  const artifactPath = ROOT_TASK_ARTIFACTS.has(command.path) || command.path.startsWith("artifacts/") ? command.path : `artifacts/${command.path}`;
  await writeTaskFile(command.taskId, artifactPath, command.content, root);
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "artifact.emitted", actor: "agent", taskId: command.taskId, runId: command.runId, path: artifactPath });
  return { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), artifactPath };
}

export async function runCommandWorkflow(command, root) {
  logStep("orchestrator", "agent.run_command", { commandId: command.commandId, taskId: command.taskId, command: command.command });
  const current = await getTask(command.taskId, root);
  if (!current) throw new Error(`Task not found: ${command.taskId}`);
  assertActiveRun(current, command.runId);
  const baseCwd = resolve(current.worktree?.path || paths(root).root);
  const cwd = command.cwd && command.cwd !== "worktree" ? resolve(baseCwd, command.cwd) : baseCwd;
  if (cwd !== baseCwd && !cwd.startsWith(`${baseCwd}/`)) throw new Error("cwd_outside_task_workspace");
  try {
    const result = await exec(command.command, command.args || [], { cwd, timeout: command.timeoutMs || 120000 });
    const output = { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), cwd, stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.command", actor: current.routing?.currentRole || current.routing?.currentAgent || "agent", taskId: command.taskId, runId: command.runId, command: command.command, args: command.args || [], cwd, exitCode: 0 });
    return output;
  } catch (error) {
    const output = { ok: false, commandId: command.commandId, task: TaskSchema.parse(current), cwd, stdout: error.stdout || "", stderr: error.stderr || error.message, exitCode: error.code || 1 };
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.command", actor: current.routing?.currentRole || current.routing?.currentAgent || "agent", taskId: command.taskId, runId: command.runId, command: command.command, args: command.args || [], cwd, exitCode: output.exitCode, stderr: output.stderr });
    return output;
  }
}

export async function stepWorkflow(command, root, handleCommand) {
  logStep("orchestrator", "agent.step", { commandId: command.commandId, taskId: command.taskId, disposition: command.disposition?.type });
  const disposition = command.disposition;
  if (disposition.type === "message_and_continue") return handleCommand({ type: "agent.message", commandId: `${command.commandId}:message`, message: disposition.message }, root);
  if (disposition.type === "wait_for_persona") return handleCommand({ type: "agent.wait_for_persona", commandId: `${command.commandId}:persona`, taskId: command.taskId, runId: command.runId, targetRole: disposition.targetRole, question: disposition.question, expectedArtifact: disposition.expectedArtifact }, root);
  if (disposition.type === "wait_for_human") return handleCommand({ type: "agent.wait_for_human", commandId: `${command.commandId}:human`, taskId: command.taskId, runId: command.runId, question: disposition.question, options: disposition.options, requestedByRole: disposition.requestedByRole }, root);
  if (disposition.type === "complete_for_persona") return handleCommand({ type: "agent.complete_task", commandId: `${command.commandId}:complete`, taskId: command.taskId, runId: command.runId || "manual-step", nextColumn: roleColumn(disposition.nextRole), summary: disposition.summary }, root);
  if (disposition.type === "fail_run") {
    const current = await getTask(command.taskId, root);
    const task = current ? await failTaskPreservingRouting(current, root, disposition.reason, "agent.failed") : null;
    return { ok: false, commandId: command.commandId, task, reason: disposition.reason, recoverable: disposition.recoverable };
  }
  const current = await getTask(command.taskId, root);
  return { ok: true, commandId: command.commandId, task: current, disposition };
}
