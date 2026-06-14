import { boardSnapshot, listTasks, readAgent, readSettings } from "@kca/fsdb";
import { logStep } from "@kca/core/log";
import { columnWip, locksConflict, providedContracts, providerMissingReason, taskSemaphores } from "./policies/runnability-specs.js";
import { agentMaxParallelTasks } from "./agent-capacity.js";

export class RunnabilityService {
  constructor({ root, repositories, boardService } = {}) {
    this.root = root;
    this.repositories = repositories;
    this.boardService = boardService;
  }

  async listTasks() {
    return this.repositories?.tasks?.list ? this.repositories.tasks.list() : listTasks(this.root);
  }

  async readSettings() {
    return this.repositories?.settings?.readAll ? this.repositories.settings.readAll() : readSettings(this.root);
  }

  async readAgent(agentId) {
    if (this.repositories?.settings?.readScope) {
      const scope = await this.repositories.settings.readScope("agents");
      return scope?.agents?.find((agent) => agent.id === agentId);
    }
    return readAgent(agentId, this.root);
  }

  async snapshot() {
    return this.boardService ? this.boardService.snapshot() : boardSnapshot(this.root);
  }

  async explain(task) {
    logStep("runnability-service", "explain.start", { taskId: task.id });
    if (task.column === "human_wait") {
      const result = { taskId: task.id, runnable: false, reasons: ["Aguardando resposta humana."] };
      logStep("runnability-service", "explain.done", { taskId: task.id, runnable: false });
      return result;
    }
    if (task.status === "running") {
      const result = { taskId: task.id, runnable: true, reasons: [] };
      logStep("runnability-service", "explain.done", { taskId: task.id, runnable: true });
      return result;
    }
    const tasks = await this.listTasks();
    const snapshot = await this.snapshot();
    const settings = await this.readSettings();
    const provided = providedContracts(tasks);
    const missing = (task.dependencies?.needs || []).filter((need) => !provided.has(need));
    const conflicts = locksConflict(task, tasks);
    const running = tasks.filter((candidate) => candidate.status === "running");
    const agentId = task.routing?.currentAgent || task.agent?.currentAgent || task.agent || "assistant";
    const agentLimit = agentMaxParallelTasks(await this.readAgent(agentId), settings.runtime || {}, agentId);
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
    const columnActive = tasks.filter((candidate) => candidate.id !== task.id && candidate.column === task.column && ["running", "validating", "merge_pending"].includes(candidate.status));
    const semaphores = taskSemaphores(task);
    const semaphoreConflicts = semaphores.flatMap((semaphore) => {
      const users = running.filter((candidate) => taskSemaphores(candidate).some((item) => item.name === semaphore.name));
      return users.length >= (semaphore.tokens || 1) ? [`${semaphore.name} ocupado por ${users.map((item) => item.id).join(", ")}`] : [];
    });
    const reasons = [];
    if (missing.length) reasons.push(`Aguardando contratos: ${missing.join(", ")}.`);
    if (conflicts.length) reasons.push(`Locks indisponíveis: ${conflicts.join(", ")}.`);
    if (running.length >= maxParallelTasks) reasons.push(`Limite global de tasks atingido: ${running.length}/${maxParallelTasks}.`);
    if (agentRunning.length >= agentLimit) reasons.push(`Tokens do agent ${agentId} ocupados: ${agentRunning.length}/${agentLimit}.`);
    if (projectConflicts.length) reasons.push(`Tokens de projeto ocupados: ${projectConflicts.join(", ")}.`);
    if (wip && columnActive.length >= wip) reasons.push(`WIP da coluna ${task.column} atingido: ${columnActive.length}/${wip}.`);
    if (semaphoreConflicts.length) reasons.push(`Semáforos indisponíveis: ${semaphoreConflicts.join(", ")}.`);
    if (!reasons.length && !["idle", "queued", "validating"].includes(task.status)) reasons.push(`Status atual: ${task.status}.`);
    const providerReason = await providerMissingReason(task, this.root, agentId);
    if (providerReason) reasons.push(providerReason);
    const result = { taskId: task.id, runnable: reasons.length === 0, reasons };
    logStep("runnability-service", "explain.done", { taskId: task.id, runnable: result.runnable });
    return result;
  }
}

export function createRunnabilityService(root, options = {}) {
  return new RunnabilityService({ root, ...options });
}
