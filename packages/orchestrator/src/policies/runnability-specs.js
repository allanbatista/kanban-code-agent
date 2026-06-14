import { discoverProviders, resolveProviderModel } from "@kca/core/providers";
import { roleById } from "@kca/core/roles";
import { readAgent, readSettings } from "@kca/fsdb";

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
  const settings = await readSettings(root);
  const resolved = resolveProviderModel({ settings, agentConfig, role });
  const discovery = discoverProviders(settings);
  const anyActive = discovery.providers.some((item) => item.active);
  if (!anyActive && (resolved.inheritedProvider || resolved.legacyPi)) return null;
  const discovered = discovery.providers.find((item) => item.id === resolved.provider);
  if (!discovered) return `Provider ${resolved.provider} não encontrado.`;
  if (!discovered.enabled) return `Provider ${resolved.provider} inativo.`;
  if (!discovered.configured) return `Provider ${resolved.provider} sem envvars: ${discovered.missingEnv.join(", ")}.`;
  if (!resolved.model) return `Provider ${resolved.provider} sem modelo padrão configurado.`;
  return null;
}
