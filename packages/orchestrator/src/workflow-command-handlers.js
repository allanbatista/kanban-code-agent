import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CommandBus } from "@kca/application/command-bus";
import { QueryBus } from "@kca/application/query-bus";
import { managerRoutingContext } from "@kca/agent-runtime";
import { createBoardService } from "@kca/board-service";
import { roleById } from "@kca/core/roles";
import { appendJsonl, getTask, listTasks, paths, readCommandResult, recordCommandResult, updateSettings } from "@kca/fsdb";
import { appendChatMessage, compactTaskPersonaChat, resetBoardChat } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { logStep } from "@kca/core/log";
import { TaskSchema } from "@kca/schemas";
import { createTaskService } from "@kca/task-service";
import { deployTaskGate, reviewTaskGate } from "./gate-service.js";
import { runHooks } from "./hook-service.js";
import { mergeTaskWorkflow } from "./merge-workflow-service.js";
import { delegateTaskWorkflow, waitForHumanWorkflow, waitForPersonaWorkflow } from "./persona-workflow-service.js";
import { createRunnabilityService } from "./runnability-service.js";
import { schedulerTick } from "./scheduler.js";
import { agentChatWorkflow } from "./agent-chat-workflow-service.js";
import { completeTaskWorkflow, emitArtifactWorkflow, interruptTaskWorkflow, reportBlockerWorkflow, requestUserInputWorkflow, runCommandWorkflow, runTaskWorkflow, stepWorkflow } from "./task-agent-workflow-service.js";
import { decomposeTaskWorkflow } from "./task-decomposition-service.js";

const roots = new Map();

function services(root) {
  const key = root || "";
  if (!roots.has(key)) {
    const boardService = createBoardService(root);
    roots.set(key, {
      boardService,
      taskService: createTaskService(root, { boardService }),
      runnabilityService: createRunnabilityService(root, { boardService })
    });
  }
  return roots.get(key);
}

function roleAgent(roleId) {
  return roleById(roleId)?.agentId || roleId;
}

export async function whyNotRunning(task, root) {
  return services(root).runnabilityService.explain(task);
}

export function shouldDrainSchedulerAfterCommand(command) {
  return [
    "task.create",
    "task.move",
    "task.decompose",
    "task.answer_input",
    "task.comment",
    "task.merge",
    "agent.complete_task",
    "agent.report_blocker",
    "agent.request_user_input",
    "agent.wait_for_persona",
    "agent.wait_for_human",
    "agent.delegate_task",
    "agent.review_task",
    "agent.deploy_task",
    "role.route_task",
    "settings.update"
  ].includes(command.type);
}

async function drainScheduler(root, source, maxStarts) {
  logStep("orchestrator", "scheduler.drain", { source });
  const result = await schedulerTick(root, {
    maxStarts,
    whyNotRunning,
    runTask: (task) => handleCommand({
      type: "task.run",
      commandId: `scheduler-run-${task.id}-${Date.now()}`,
      taskId: task.id,
      agentId: task.routing?.currentAgent || roleAgent(task.routing?.currentRole) || task.agent?.currentAgent || task.agent || undefined
    }, root)
  });
  result.commandId = `scheduler-${source}-${Date.now()}`;
  return result;
}

async function shouldDrainCreateResult(result, root) {
  if (result?.task?.status !== "queued") return false;
  const snapshot = await services(root).boardService.snapshot();
  return Boolean(snapshot.columns.find((column) => column.id === result.task.column)?.autoStart);
}

async function requiredTask(taskId, root) {
  const current = await getTask(taskId, root);
  if (!current) throw new Error(`Task not found: ${taskId}`);
  return current;
}

async function taskTextFiles(taskId, root) {
  const p = paths(root);
  const read = async (file) => {
    try {
      return await readFile(join(p.tasks, taskId, file), "utf8");
    } catch {
      return "";
    }
  };
  return { description: await read("description.md"), acceptance: await read("acceptance.md") };
}

async function redirectManagerDecomposeToProduct(command, current, root) {
  if (!command.runId || (current.routing?.currentRole || current.routing?.currentAgent) !== "manager") return null;
  const { description, acceptance } = await taskTextFiles(current.id, root);
  const routing = managerRoutingContext(current, description, acceptance);
  if (routing.managerMode !== "intake" || routing.targetRole !== "product") return null;
  const question = [
    `Define the product contract for ${current.id} before decomposition.`,
    routing.reason,
    "Persist verifiable acceptance criteria in `acceptance.md`, then choose the next execution path."
  ].join("\n\n");
  const result = await waitForPersonaWorkflow({
    type: "agent.wait_for_persona",
    commandId: command.commandId,
    taskId: command.taskId,
    runId: command.runId,
    targetRole: "product",
    question,
    expectedArtifact: "acceptance.md"
  }, current, root);
  await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, {
    ts: new Date().toISOString(),
    type: "task.decompose.redirected",
    actor: "orchestrator",
    taskId: current.id,
    runId: command.runId,
    fromRole: "manager",
    toRole: "product",
    reason: routing.reason,
    attemptedSubtasks: command.subtasks?.length || 0
  });
  return { ...result, redirected: true, guard: { type: "manager_intake_requires_product", reason: routing.reason } };
}

function createWorkflowCommandHandlers(root) {
  const { taskService } = services(root);
  return {
    "task.create": async (command) => {
    logStep("orchestrator", "task.create", { commandId: command.commandId });
    const task = await taskService.createTask(command.input);
    return { ok: true, commandId: command.commandId, task };
    },

    "task.update": async (command) => {
    logStep("orchestrator", "task.update", { commandId: command.commandId, taskId: command.taskId });
    const task = await taskService.updateTask(command.taskId, command.patch);
    return { ok: true, commandId: command.commandId, task };
    },

    "task.file.write": async (command) => {
    logStep("orchestrator", "task.file.write", { commandId: command.commandId, taskId: command.taskId, path: command.path });
    const written = await taskService.writeTaskFile(command.taskId, command.path, command.content);
    return { ok: true, commandId: command.commandId, ...written };
    },

    "task.attachment.write": async (command) => {
    logStep("orchestrator", "task.attachment.write", { commandId: command.commandId, taskId: command.taskId, fileName: command.fileName });
    const written = await taskService.writeTaskAttachment(command.taskId, command.fileName, command.contentType, command.dataBase64);
    return { ok: true, commandId: command.commandId, ...written };
    },

    "task.move": async (command) => {
    logStep("orchestrator", "task.move.start", { commandId: command.commandId, taskId: command.taskId, toColumn: command.toColumn });
    const { task, hooks, noop } = await taskService.moveTask(command.taskId, command.toColumn, { runHooks: (task, trigger) => runHooks(task, root, trigger) });
    return { ok: true, commandId: command.commandId, task, hooks, noop: Boolean(noop) };
    },

    "task.run": (command) => runTaskWorkflow(command, root, whyNotRunning, handleCommand),

    "task.interrupt": (command) => interruptTaskWorkflow(command, root),

    "agent.complete_task": (command) => completeTaskWorkflow(command, root),

    "agent.report_blocker": (command) => reportBlockerWorkflow(command, root),

    "agent.request_user_input": (command) => requestUserInputWorkflow(command, root),

    "agent.message": async (command) => {
    logStep("orchestrator", "agent.message", { commandId: command.commandId, taskId: command.message.taskId || null });
    const message = await appendChatMessage(root, { ...command.message, role: command.message.persona === "user" ? "user" : "assistant", disposition: "message_and_continue", commandId: command.commandId });
    if (command.message.taskId) await appendJsonl(`${paths(root).tasks}/${command.message.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "agent.message", actor: command.message.persona, taskId: command.message.taskId, messageId: message.id });
    return { ok: true, commandId: command.commandId, message };
    },

    "agent.wait_for_persona": async (command) => {
    logStep("orchestrator", "agent.wait_for_persona", { commandId: command.commandId, taskId: command.taskId, targetRole: command.targetRole });
    return waitForPersonaWorkflow(command, await requiredTask(command.taskId, root), root);
    },

    "agent.wait_for_human": async (command) => {
    logStep("orchestrator", "agent.wait_for_human", { commandId: command.commandId, taskId: command.taskId });
    return waitForHumanWorkflow(command, await requiredTask(command.taskId, root), root);
    },

    "agent.delegate_task": async (command) => {
    logStep("orchestrator", "agent.delegate_task", { commandId: command.commandId, taskId: command.taskId, fromPersona: command.fromPersona, toPersona: command.toPersona });
    return delegateTaskWorkflow(command, await requiredTask(command.taskId, root), root);
    },

    "task.answer_input": async (command) => {
    logStep("orchestrator", "task.answer_input", { commandId: command.commandId, taskId: command.taskId });
    const task = await taskService.answerInput(command.taskId, command.answer, command.returnRole);
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task };
    },

    "task.comment": async (command) => {
    logStep("orchestrator", "task.comment", { commandId: command.commandId, taskId: command.taskId });
    const current = await requiredTask(command.taskId, root);
    const activeRunId = current.status === "running" ? current.agent?.currentRunId : null;
    const returnRole = activeRunId
      ? current.routing?.currentRole || current.routing?.currentAgent || "manager"
      : current.column === "human_wait"
        ? current.routing?.lastRole || current.routing?.lastAgent || "manager"
        : current.routing?.currentRole || current.routing?.lastRole || current.routing?.currentAgent || "manager";
    const message = await appendChatMessage(root, {
      scope: "task",
      taskId: command.taskId,
      role: "user",
      persona: returnRole,
      displayPersona: "human",
      agentId: "user",
      text: command.text,
      commandId: command.commandId,
      disposition: command.replyToMessageId ? "reply" : "comment",
      replyToMessageId: command.replyToMessageId
    });
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "task.comment", actor: "user", displayPersona: "human", returnRole, taskId: command.taskId, messageId: message.id, replyToMessageId: command.replyToMessageId || null, deferredForRunId: activeRunId, deferredForAgent: activeRunId ? current.routing?.currentAgent || null : null, deferredForRole: activeRunId ? current.routing?.currentRole || null : null });
    if (current.column === "human_wait" && ["idle", "waiting_human"].includes(current.status)) {
      const task = await taskService.answerInput(command.taskId, command.text, returnRole);
      await releaseSemaphoreLeases({ root, taskId: command.taskId });
      return { ok: true, commandId: command.commandId, task, message, resumed: true };
    }
    if (activeRunId) return { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), message, resumed: false, deferred: true };
    return { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), message, resumed: false };
    },

    "role.route_task": async (command) => {
    logStep("orchestrator", "role.route_task", { commandId: command.commandId, taskId: command.taskId, role: command.role });
    const task = await taskService.routeTask(command.taskId, command.role);
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task };
    },

    "chat.compact": async (command) => {
    logStep("orchestrator", "chat.compact", { commandId: command.commandId, taskId: command.taskId, persona: command.persona });
    const current = await requiredTask(command.taskId, root);
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "chat.compaction_requested", actor: command.persona, taskId: command.taskId });
    const compaction = await compactTaskPersonaChat(root, { taskId: command.taskId, persona: command.persona, summary: command.summary, tokenStats: command.tokenStats });
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "chat.compacted", actor: command.persona, taskId: command.taskId, ...compaction });
    return { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), compaction };
    },

    "chat.reset_board": async (command) => {
    logStep("orchestrator", "chat.reset_board", { commandId: command.commandId, agentId: command.agentId });
    const chat = await resetBoardChat(root, { agentId: command.agentId });
    return { ok: true, commandId: command.commandId, chat };
    },

    "agent.review_task": async (command) => {
    logStep("orchestrator", "agent.review_task", { commandId: command.commandId, taskId: command.taskId });
    return reviewTaskGate(command, await requiredTask(command.taskId, root), root);
    },

    "agent.deploy_task": async (command) => {
    logStep("orchestrator", "agent.deploy_task", { commandId: command.commandId, taskId: command.taskId });
    return deployTaskGate(command, await requiredTask(command.taskId, root), root);
    },

    "agent.step": (command) => stepWorkflow(command, root, handleCommand),

    "agent.emit_artifact": (command) => emitArtifactWorkflow(command, root),

    "agent.run_command": (command) => runCommandWorkflow(command, root),

    "agent.chat": (command) => agentChatWorkflow(command, root, whyNotRunning),

    "task.decompose": async (command) => {
    const current = await requiredTask(command.taskId, root);
    const redirected = await redirectManagerDecomposeToProduct(command, current, root);
    return redirected || decomposeTaskWorkflow(command, current, root);
    },

    "task.merge": async (command) => {
    logStep("orchestrator", "task.merge.start", { commandId: command.commandId, taskId: command.taskId });
    return mergeTaskWorkflow(command, await requiredTask(command.taskId, root), await listTasks(root), root);
    },

    "scheduler.tick": async (command) => {
    logStep("orchestrator", "scheduler.tick", { commandId: command.commandId, maxStarts: command.maxStarts });
    const result = await drainScheduler(root, command.commandId, command.maxStarts);
    result.commandId = command.commandId;
    return result;
    },

    "settings.update": async (command) => {
    logStep("orchestrator", "settings.update", { commandId: command.commandId, scope: command.scope });
    const settings = await updateSettings(command.scope, command.patch, root);
    return { ok: true, commandId: command.commandId, settings };
    }
  };
}

export async function handleCommand(input, root) {
  const bus = new CommandBus({
    handlers: createWorkflowCommandHandlers(root),
    resultStore: {
      get: (commandId) => readCommandResult(commandId, root),
      put: (commandId, result) => recordCommandResult(commandId, result, root)
    },
    schedulerDrain: async (command, result) => {
      if (!result || command.type === "scheduler.tick" || !shouldDrainSchedulerAfterCommand(command)) return result;
      if (command.type === "task.create" && !(await shouldDrainCreateResult(result, root))) return result;
      if (command.type === "task.move" && result.noop) return result;
      if (command.type === "task.comment" && result.deferred) return result;
      if (command.type === "task.merge" && result.merge?.reason === "parent_merge_busy") return result;
      return { ...result, scheduler: await drainScheduler(root, command.type) };
    }
  });
  return bus.execute(input, { root });
}

export async function handleQuery(input, root) {
  const { boardService } = services(root);
  const queryBus = new QueryBus({
    handlers: {
      "board.snapshot": () => boardService.snapshot(),
      "orchestrator.status": () => boardService.orchestratorStatus(),
      "settings.scope": (query) => boardService.settingsScope(query.scope),
      "chat.history": (query) => boardService.chatHistory(query),
      "task.comments": (query) => boardService.taskComments(query),
      "agent.logs": (query) => boardService.agentLogs(query),
      "provider.discover": () => boardService.providerDiscover(),
      "provider.models": (query) => boardService.providerModels(query),
      "chat.build": (query) => boardService.chatBuild({ ...query, agentId: roleAgent(query.persona) }),
      "task.files": (query) => boardService.taskFiles(query.taskId),
      "task.detail": (query) => boardService.taskDetail(query.taskId),
      "why_not_running": async (query) => {
        const task = await getTask(query.taskId, root);
        if (!task) throw new Error(`Task not found: ${query.taskId}`);
        return whyNotRunning(task, root);
      }
    }
  });
  return queryBus.execute(input, { root });
}
