import { discoverProviders } from "@kca/core/providers";
import { roleById } from "@kca/core/roles";
import { readAgent } from "@kca/fsdb";

export function providedContracts(tasks) {
  return new Set(tasks.filter((task) => ["done", "validating"].includes(task.status)).flatMap((task) => task.dependencies?.provides || []));
}

export function locksConflict(task, tasks) {
  const locks = task.dependencies?.fileLocks || [];
  if (!locks.length) return [];
  return tasks
    .filter((candidate) => candidate.id !== task.id && candidate.status === "running")
    .flatMap((candidate) => (candidate.dependencies?.fileLocks || []).filter((lock) => locks.includes(lock)).map((lock) => `${lock} locked by ${candidate.id}`));
}

export function taskSemaphores(task) {
  return (task.dependencies?.semaphores || []).map((item) => typeof item === "string" ? { name: item, tokens: 1 } : item).filter((item) => item?.name);
}

export function columnWip(columnId, board) {
  return board?.columns?.find((column) => column.id === columnId)?.wip ?? null;
}

export async function providerMissingReason(task, root, agentId) {
  const role = roleById(task.routing?.currentRole || task.routing?.currentAgent);
  const agentConfig = await readAgent(agentId, root);
  const provider = agentConfig?.model?.provider || role?.model?.provider;
  if (!provider || provider === "pi") return null;
  const discovered = discoverProviders().providers.find((item) => item.id === provider);
  return discovered && !discovered.configured ? `Provider ${provider} sem envvars: ${discovered.missingEnv.join(", ")}.` : null;
}
