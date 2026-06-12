import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { interruptRun, startRun, writeRunSummary } from "@kca/agent-runtime";
import { createWorktree, mergeSubtask } from "@kca/git-worktree";
import { appendJsonl, boardSnapshot, createTask, getTask, listTasks, moveTask, paths, readAgent, readCommandResult, readHook, readProject, readSettings, readSettingsScope, recordCommandResult, updateSettings, updateTask, writeTaskFile, writeYaml } from "@kca/fsdb";
import { runBoardAssistant, loadPiSdk } from "@kca/pi-adapter";
import { parseCommand, parseQuery, TaskSchema } from "@kca/schemas";

const execFile = promisify(execFileCallback);

function providedContracts(tasks) {
  return new Set(tasks.filter((task) => ["done", "validating"].includes(task.status)).flatMap((task) => task.dependencies?.provides || []));
}

function locksConflict(task, tasks) {
  const locks = task.dependencies?.fileLocks || [];
  if (!locks.length) return [];
  return tasks
    .filter((candidate) => candidate.id !== task.id && candidate.status === "running")
    .flatMap((candidate) => (candidate.dependencies?.fileLocks || []).filter((lock) => locks.includes(lock)).map((lock) => `${lock} locked by ${candidate.id}`));
}

function columnWip(columnId, board) {
  return board?.columns?.find((column) => column.id === columnId)?.wip ?? null;
}

function taskSemaphores(task) {
  return (task.dependencies?.semaphores || []).map((item) => typeof item === "string" ? { name: item, tokens: 1 } : item).filter((item) => item?.name);
}

function virtualAssistantTask(scope, prompt) {
  return {
    id: scope === "task" ? "TASK-ASSISTANT" : "BOARD-ASSISTANT",
    title: `${scope} assistant: ${String(prompt).slice(0, 80)}`,
    kind: "task",
    column: "inbox",
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

async function executeHookAction(config, task, root, hook, p) {
  const kind = config?.kind || "noop";
  if (!["command", "script"].includes(kind)) return null;
  const spec = kind === "script" ? config.script : config.command;
  const command = typeof spec === "string" ? spec : spec?.command || spec?.bin || spec?.path;
  const args = typeof spec === "object" && Array.isArray(spec.args) ? spec.args : Array.isArray(config.args) ? config.args : [];
  if (!command) throw new Error(`hook_${kind}_missing_command`);
  const { stdout, stderr } = await execFile(command, args, {
    cwd: config.cwd || (typeof spec === "object" ? spec.cwd : null) || p.root,
    timeout: config.timeoutMs || 120000,
    maxBuffer: 128 * 1024,
    env: { ...process.env, KCA_TASK_ID: task.id, KCA_HOOK_ID: hook, KCA_STORAGE_ROOT: p.root }
  });
  return { stdout: String(stdout || "").slice(0, 8192), stderr: String(stderr || "").slice(0, 8192) };
}

export async function whyNotRunning(task, root) {
  if (task.status === "running") return { taskId: task.id, runnable: true, reasons: [] };
  const tasks = await listTasks(root);
  const snapshot = await boardSnapshot(root);
  const settings = await readSettings(root);
  const provided = providedContracts(tasks);
  const missing = (task.dependencies?.needs || []).filter((need) => !provided.has(need));
  const conflicts = locksConflict(task, tasks);
  const running = tasks.filter((candidate) => candidate.status === "running");
  const agentId = task.routing?.currentAgent || task.agent?.currentAgent || task.agent || "assistant";
  const agentLimit = settings.runtime?.agentTokens?.[agentId] ?? 1;
  const agentRunning = running.filter((candidate) => (candidate.routing?.currentAgent || candidate.agent?.currentAgent || candidate.agent || "assistant") === agentId);
  const projectTokenLimits = settings.runtime?.projectTokens || {};
  const projectConflicts = (task.projectTargets || []).flatMap((projectId) => {
    const limit = projectTokenLimits[projectId];
    if (!limit) return [];
    const projectRunning = running.filter((candidate) => (candidate.projectTargets || []).includes(projectId));
    return projectRunning.length >= limit ? [`${projectId}: ${projectRunning.length}/${limit}`] : [];
  });
  const maxParallelTasks = settings.runtime?.maxParallelTasks ?? 3;
  const wip = columnWip(task.column, snapshot);
  const columnActive = tasks.filter((candidate) => candidate.column === task.column && ["queued", "running", "validating", "merge_pending"].includes(candidate.status));
  const semaphores = taskSemaphores(task);
  const semaphoreConflicts = semaphores.flatMap((semaphore) => {
    const users = running.filter((candidate) => taskSemaphores(candidate).some((item) => item.name === semaphore.name));
    return users.length >= (semaphore.tokens || 1) ? [`${semaphore.name} ocupado por ${users.map((item) => item.id).join(", ")}`] : [];
  });
  const reasons = [];
  if (task.status === "blocked") reasons.push("Task está bloqueada.");
  if (task.dependencies?.blockedBy?.length) reasons.push(`Bloqueada por: ${task.dependencies.blockedBy.join(", ")}.`);
  if (missing.length) reasons.push(`Aguardando contratos: ${missing.join(", ")}.`);
  if (conflicts.length) reasons.push(`Locks indisponíveis: ${conflicts.join(", ")}.`);
  if (running.length >= maxParallelTasks) reasons.push(`Limite global de tasks atingido: ${running.length}/${maxParallelTasks}.`);
  if (agentRunning.length >= agentLimit) reasons.push(`Tokens do agent ${agentId} ocupados: ${agentRunning.length}/${agentLimit}.`);
  if (projectConflicts.length) reasons.push(`Tokens de projeto ocupados: ${projectConflicts.join(", ")}.`);
  if (wip && columnActive.length >= wip) reasons.push(`WIP da coluna ${task.column} atingido: ${columnActive.length}/${wip}.`);
  if (semaphoreConflicts.length) reasons.push(`Semáforos indisponíveis: ${semaphoreConflicts.join(", ")}.`);
  if (!reasons.length && !["idle", "queued", "validating"].includes(task.status)) reasons.push(`Status atual: ${task.status}.`);
  return { taskId: task.id, runnable: reasons.length === 0, reasons };
}

async function orchestratorStatus(root) {
  const tasks = await listTasks(root);
  const settings = await readSettings(root);
  const running = tasks.filter((task) => task.status === "running");
  const queued = tasks.filter((task) => task.status === "queued");
  const mergePending = tasks.filter((task) => task.status === "merge_pending");
  const blocked = tasks.filter((task) => task.status === "blocked");
  return {
    schema: "kanban-code-agent/orchestrator-status@1",
    capacity: {
      running: running.length,
      maxParallelTasks: settings.runtime?.maxParallelTasks ?? 3,
      maxParallelMerges: settings.runtime?.maxParallelMerges ?? 1,
      agentTokens: settings.runtime?.agentTokens || {},
      projectTokens: settings.runtime?.projectTokens || {}
    },
    queue: queued.map((task) => task.id),
    running: running.map((task) => ({ id: task.id, agent: task.routing?.currentAgent || task.agent?.currentAgent || task.agent || "assistant" })),
    merges: mergePending.map((task) => task.id),
    worktrees: tasks.filter((task) => task.worktree?.enabled).map((task) => ({ taskId: task.id, branch: task.worktree?.branch, path: task.worktree?.path })),
    blockers: blocked.map((task) => ({ taskId: task.id, title: task.title, blockedBy: task.dependencies?.blockedBy || [] }))
  };
}

async function runHooks(task, root, trigger) {
  const hooks = task.hooks?.active || [];
  const p = paths(root);
  const events = [];
  for (const hook of hooks) {
    const config = await readHook(hook, root);
    const started = { ts: new Date().toISOString(), type: "hook.started", actor: "orchestrator", taskId: task.id, hook, trigger, kind: config?.kind || "noop" };
    await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, started);
    events.push(started);
    try {
      const action = await executeHookAction(config, task, root, hook, p);
      if (config?.outputs?.writeSummaryTo) {
        const body = action ? `\n\n## stdout\n\n${action.stdout || "(vazio)"}\n\n## stderr\n\n${action.stderr || "(vazio)"}\n` : "\n";
        await writeTaskFile(task.id, config.outputs.writeSummaryTo, `# ${config.label || hook}\n\nHook ${hook} executado em ${started.ts} para ${task.id}.${body}`, root);
      }
      if (config?.outputs?.emitArtifact) {
        await writeTaskFile(task.id, config.outputs.emitArtifact, action ? `${action.stdout}${action.stderr ? `\n${action.stderr}` : ""}` : `Hook ${hook} executado em ${started.ts}.\n`, root);
      }
      const completed = { ts: new Date().toISOString(), type: "hook.completed", actor: "hook", taskId: task.id, hook, trigger, kind: config?.kind || "noop", stdout: action?.stdout, stderr: action?.stderr };
      await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, completed);
      events.push(completed);
    } catch (error) {
      const failed = { ts: new Date().toISOString(), type: "hook.failed", actor: "hook", taskId: task.id, hook, trigger, error: error.message };
      await appendJsonl(`${p.tasks}/${task.id}/events.jsonl`, failed);
      events.push(failed);
    }
  }
  return events;
}

export async function handleCommand(input, root) {
  const command = parseCommand(input);
  const cached = await readCommandResult(command.commandId, root);
  if (cached) return { ...cached, idempotent: true };

  let result;
  if (command.type === "task.create") {
    const task = TaskSchema.parse(await createTask(command.input, root));
    result = { ok: true, commandId: command.commandId, task };
  }

  if (command.type === "task.update") {
    const task = TaskSchema.parse(await updateTask(command.taskId, command.patch, root));
    result = { ok: true, commandId: command.commandId, task };
  }

  if (command.type === "task.move") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const patch = ["running", "interrupting"].includes(current.status)
      ? { routing: { ...current.routing, manualOverride: { active: true, lastManualMoveAt: new Date().toISOString(), invalidatesRunId: current.agent?.currentRunId || null } } }
      : {};
    if (Object.keys(patch).length) await updateTask(command.taskId, patch, root, "task.move_requested");
    const task = TaskSchema.parse(await moveTask(command.taskId, command.toColumn, root));
    const hooks = await runHooks(task, root, "onColumnEnter");
    result = { ok: true, commandId: command.commandId, task, hooks };
  }

  if (command.type === "task.run") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const why = await whyNotRunning(current, root);
    if (!why.runnable) {
      const task = TaskSchema.parse(await updateTask(command.taskId, { status: "queued" }, root, "agent.queued"));
      result = { ok: false, commandId: command.commandId, task, why };
    } else {
      let runnableTask = current;
      if (current.worktree?.enabled && !current.worktree.path) {
        const project = current.projectTargets?.[0] ? await readProject(current.projectTargets[0], root) : null;
        if (project?.repoPath) {
          const worktree = await createWorktree({ repoPath: project.repoPath, taskId: current.id, branch: current.worktree.branch, root: `${paths(root).runtime}/worktrees` });
          if (worktree.ok) {
            await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, { ts: new Date().toISOString(), type: "worktree.created", actor: "orchestrator", taskId: current.id, path: worktree.worktreePath, branch: worktree.branch });
            runnableTask = await updateTask(current.id, { worktree: { ...current.worktree, path: worktree.worktreePath, repoPath: project.repoPath } }, root, "worktree.updated");
          }
        }
      }
      const run = await startRun(runnableTask, root, command.agentId);
      const task = TaskSchema.parse(await updateTask(command.taskId, {
        status: "running",
        routing: { ...runnableTask.routing, currentAgent: run.agentId },
        agent: { currentRunId: run.runId, currentSessionRef: run.sessionRef, resumeMode: "continue", lastSummary: run.summaryRef }
      }, root, "agent.started"));
      result = { ok: true, commandId: command.commandId, task, run };
    }
  }

  if (command.type === "task.interrupt") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const event = await interruptRun(current, root, command.mode);
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: command.mode === "hard" ? "idle" : "interrupting",
      routing: { ...current.routing, manualOverride: { active: true, lastManualMoveAt: event.ts, invalidatesRunId: current.agent?.currentRunId || null } }
    }, root, "agent.interrupted"));
    result = { ok: true, commandId: command.commandId, task, event };
  }

  if (command.type === "agent.complete_task") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    if (current.agent?.currentRunId && current.agent.currentRunId !== command.runId) throw new Error("run_mismatch");
    if (current.routing?.manualOverride?.active && current.routing.manualOverride.invalidatesRunId === command.runId) throw new Error("manual_override_active");
    const summaryRef = await writeRunSummary(current, root, command.runId, command.summary);
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: command.nextColumn === "done" ? "done" : "validating",
      column: command.nextColumn,
      agent: { ...current.agent, lastSummary: summaryRef }
    }, root, "agent.completed"));
    result = { ok: true, commandId: command.commandId, task, summaryRef };
  }

  if (command.type === "agent.report_blocker") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "blocked",
      column: "blocked",
      dependencies: { ...current.dependencies, blockedBy: [...(current.dependencies?.blockedBy || []), command.blocker] }
    }, root, "task.blocked"));
    result = { ok: true, commandId: command.commandId, task };
  }

  if (command.type === "agent.request_user_input") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const relativePath = `summaries/input-${Date.now()}.md`;
    await writeTaskFile(command.taskId, relativePath, `# Input solicitado\n\n${command.question}\n`, root);
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "blocked",
      column: "blocked",
      dependencies: { ...current.dependencies, blockedBy: [...(current.dependencies?.blockedBy || []), `input:${relativePath}`] }
    }, root, "agent.input_requested"));
    result = { ok: true, commandId: command.commandId, task, inputPath: relativePath };
  }

  if (command.type === "agent.emit_artifact") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const artifactPath = command.path.startsWith("artifacts/") ? command.path : `artifacts/${command.path}`;
    await writeTaskFile(command.taskId, artifactPath, command.content, root);
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "artifact.emitted", actor: "agent", taskId: command.taskId, runId: command.runId, path: artifactPath });
    result = { ok: true, commandId: command.commandId, task: TaskSchema.parse(current), artifactPath };
  }

  if (command.type === "agent.chat") {
    const agentId = command.agentId || "assistant";
    const prompt = String(command.prompt || "");
    const p = paths(root);
    const piLoaded = await loadPiSdk();
    const useRealAgent = piLoaded.ok && piLoaded.mode === "real";

    if (useRealAgent) {
      // Load agent instructions for the system prompt
      let instructions = "";
      try {
        const agentConfig = await readAgent(agentId, root);
        if (agentConfig?.instructionsPath) {
          instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
        }
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
            const def = subtasks[i] || { title: `${parent.title}: subtask ${i + 1}`, agent: i === 0 ? "engineer" : "validator" };
            const task = await createTask({
              id: `${taskId}-${String(i + 1).padStart(2, "0")}`,
              title: def.title,
              kind: "subtask",
              column: "definition",
              status: "queued",
              projectTargets: parent.projectTargets || [],
              agent: def.agent || "engineer",
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
          const run = await startRun(task, root, agentIdOverride || task.routing?.currentAgent || "engineer");
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

      const agentResult = await runBoardAssistant({ prompt, agentId, instructions, root: p.root, context: kanbanContext });

      await appendJsonl(`${p.runtime}/logs/events.jsonl`, {
        ts: new Date().toISOString(),
        type: "agent.event",
        actor: agentId,
        scope: command.scope,
        taskId: command.selectedTaskId || command.taskId || null,
        prompt: command.prompt,
        reply: agentResult.reply,
        ok: agentResult.ok
      });

      result = { ok: true, commandId: command.commandId, reply: agentResult.reply, agentOk: agentResult.ok };
    } else {
      // Fallback: keyword-matching assistant for fake mode / tests
      const promptTaskId = String(command.prompt).match(/\bKCA-[A-Za-z0-9-]+\b/)?.[0];
      const current = command.taskId || command.selectedTaskId || promptTaskId ? await getTask(command.taskId || command.selectedTaskId || promptTaskId, root) : null;
      const agentTask = current || virtualAssistantTask(command.scope, command.prompt);
      const run = await startRun(agentTask, root, command.agentId || "assistant");
      const lower = command.prompt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      let action = null;
      let reply = command.scope === "task" && current
        ? `Analisei ${current.id} com o agent ${run.agentId}.`
        : `Analisei o board com o agent ${run.agentId}.`;

      if (lower.includes("criar") && lower.includes("task")) {
        const title = command.prompt.replace(/.*criar\s+(uma\s+)?task\s*/i, "").trim() || "Task criada pelo assistant";
        const task = TaskSchema.parse(await createTask({ title, description: "Criada pelo assistant do board.", projectTargets: [] }, root));
        action = { type: "task.created", taskId: task.id };
        reply = `Criei ${task.id}: ${task.title}`;
      } else if ((lower.includes("mover") || lower.includes("mova")) && current) {
        const snapshot = await boardSnapshot(root);
        const target = snapshot.columns.find((column) => lower.includes(column.id.toLowerCase()) || lower.includes(String(column.label || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
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
      } else if ((lower.includes("decompor") || lower.includes("decomponha") || lower.includes("subtask")) && current) {
        const first = TaskSchema.parse(await createTask({
          id: `${current.id}-01`,
          title: `${current.title}: implementação`,
          kind: "subtask",
          column: "definition",
          status: "queued",
          projectTargets: current.projectTargets,
          agent: "engineer",
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
          agent: "validator",
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
      result = { ok: true, commandId: command.commandId, run, reply, action };
    }
  }

  if (command.type === "task.decompose") {
    const parent = await getTask(command.taskId, root);
    if (!parent) throw new Error(`Task not found: ${command.taskId}`);
    const subtasks = command.subtasks?.length ? command.subtasks : [
      { title: `${parent.title}: implementação`, needs: parent.dependencies?.needs || [], provides: [`subtask:${parent.id}:implementation`], fileLocks: parent.dependencies?.fileLocks || [], agentId: "engineer" },
      { title: `${parent.title}: validação`, needs: [`subtask:${parent.id}:implementation`], provides: [`subtask:${parent.id}:validation`], fileLocks: [], agentId: "validator" }
    ];
    const created = [];
    for (const [index, subtask] of subtasks.entries()) {
      created.push(TaskSchema.parse(await createTask({
        id: subtask.id || `${parent.id}-${String(index + 1).padStart(2, "0")}`,
        title: subtask.title,
        kind: "subtask",
        column: "definition",
        status: "queued",
        projectTargets: parent.projectTargets,
        agent: subtask.agentId || parent.routing?.currentAgent || "engineer",
        worktree: { enabled: true, kind: "subtask", branch: `kca/${parent.id}-${index + 1}`, pathRef: "worktree.yaml", parentTaskId: parent.id, mergeTarget: parent.worktree?.branch || "main" },
        dependencies: { needs: subtask.needs || [], provides: subtask.provides || [], blockedBy: [], fileLocks: subtask.fileLocks || [], semaphores: [] }
      }, root)));
    }
    await appendJsonl(`${paths(root).tasks}/${parent.id}/events.jsonl`, { ts: new Date().toISOString(), type: "subtasks.spawned", actor: "orchestrator", taskId: parent.id, subtasks: created.map((task) => task.id) });
    const nodes = created.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      column: task.column,
      role: task.routing?.currentAgent || task.agent || null,
      agent: task.routing?.currentAgent || task.agent || null,
      needs: task.dependencies?.needs || [],
      provides: task.dependencies?.provides || [],
      fileLocks: task.dependencies?.fileLocks || [],
      semaphores: task.dependencies?.semaphores || [],
      branch: task.worktree?.branch,
      mergeTarget: task.worktree?.mergeTarget
    }));
    await writeYaml(`${paths(root).tasks}/${parent.id}/subtasks.yaml`, {
      schema: "kanban-code-agent/subtasks@2",
      taskId: parent.id,
      parentTaskId: parent.id,
      strategy: "dag",
      mergePolicy: "sequential-into-parent-feature",
      nodes,
      subtasks: nodes,
      edges: nodes.flatMap((node) => node.needs.map((contract) => {
        const provider = nodes.find((candidate) => candidate.provides.includes(contract));
        return provider ? { from: provider.id, to: node.id, contract } : null;
      }).filter(Boolean))
    });
    result = { ok: true, commandId: command.commandId, task: parent, subtasks: created };
  }

  if (command.type === "task.merge") {
    const current = await getTask(command.taskId, root);
    if (!current) throw new Error(`Task not found: ${command.taskId}`);
    const parentTaskId = current.worktree?.parentTaskId;
    if (parentTaskId) {
      const busy = (await listTasks(root)).find((task) => task.id !== current.id && task.status === "merge_pending" && task.worktree?.parentTaskId === parentTaskId);
      if (busy) {
        const task = TaskSchema.parse(await updateTask(command.taskId, { status: "blocked", column: "blocked" }, root, "merge.blocked"));
        result = { ok: false, commandId: command.commandId, task, merge: { ok: false, status: "blocked", reason: "parent_merge_busy", parentTaskId, busyTaskId: busy.id } };
        return recordCommandResult(command.commandId, result, root);
      }
    }
    await updateTask(command.taskId, { status: "merge_pending" }, root, "merge.requested");
    const merge = await mergeSubtask({
      parentPath: command.parentPath || current.worktree?.mergeParentPath || current.worktree?.repoPath,
      subtaskBranch: command.subtaskBranch || current.worktree?.branch
    });
    if (merge.status === "merged") {
      await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "merge.completed", actor: "orchestrator", taskId: command.taskId, branch: command.subtaskBranch || current.worktree?.branch });
      const task = TaskSchema.parse(await updateTask(command.taskId, { status: "done", column: "done" }, root, "subtask.merged"));
      result = { ok: true, commandId: command.commandId, task, merge };
    } else {
      await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "merge.conflict", actor: "orchestrator", taskId: command.taskId, branch: command.subtaskBranch || current.worktree?.branch, reason: merge.reason });
      const task = TaskSchema.parse(await updateTask(command.taskId, { status: "blocked", column: "blocked" }, root, "task.blocked"));
      result = { ok: false, commandId: command.commandId, task, merge };
    }
  }

  if (command.type === "settings.update") {
    const settings = await updateSettings(command.scope, command.patch, root);
    result = { ok: true, commandId: command.commandId, settings };
  }

  return recordCommandResult(command.commandId, result, root);
}

export async function handleQuery(input, root) {
  const query = parseQuery(input);
  if (query.type === "board.snapshot") return boardSnapshot(root);
  if (query.type === "orchestrator.status") return orchestratorStatus(root);
  if (query.type === "settings.scope") return readSettingsScope(query.scope, root);
  if (query.type === "task.detail") {
    const task = await getTask(query.taskId, root);
    if (!task) throw new Error(`Task not found: ${query.taskId}`);
    return TaskSchema.parse(task);
  }
  if (query.type === "why_not_running") {
    const task = await getTask(query.taskId, root);
    if (!task) throw new Error(`Task not found: ${query.taskId}`);
    return whyNotRunning(task, root);
  }
  throw new Error(`Unsupported query: ${query.type}`);
}
