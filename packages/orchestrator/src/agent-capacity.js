export const DEFAULT_AGENT_MAX_PARALLEL_TASKS = 50;

export function agentMaxParallelTasks(agentSettings, runtime = {}, agentId = "assistant") {
  return agentSettings?.limits?.maxParallelTasks
    ?? agentSettings?.limits?.tokens
    ?? runtime.agentTokens?.[agentId]
    ?? DEFAULT_AGENT_MAX_PARALLEL_TASKS;
}

export function agentSchedulingEnabled(agentSettings, runtime = {}, agentId = "assistant") {
  return agentMaxParallelTasks(agentSettings, runtime, agentId) !== 0;
}
