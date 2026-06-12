import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl, paths, readAgent, readSkill, writeAtomic } from "@kca/fsdb";
import { startPiSession } from "@kca/pi-adapter";

export function createRunId(taskId, agentId) {
  return `run_${taskId}_${agentId}_${Date.now()}`;
}

export async function startRun(task, root, agentId = task.routing?.currentAgent || "assistant") {
  const p = paths(root);
  const runId = createRunId(task.id, agentId);
  const sessionDir = join(p.runtime, "sessions", task.id, agentId);
  const sessionRef = join("settings/runtime/sessions", task.id, agentId, "session.jsonl");
  const summaryRef = join("summaries", `run-${runId}.md`);
  const previousSessionRef = task.agent?.currentSessionRef || null;
  const previousSummaryRef = task.agent?.lastSummary || null;
  let previousSummary = "";
  if (previousSummaryRef) {
    try {
      previousSummary = await readFile(join(p.tasks, task.id, previousSummaryRef), "utf8");
    } catch {
      previousSummary = "";
    }
  }
  const started = {
    ts: new Date().toISOString(),
    type: "agent.started",
    actor: "orchestrator",
    taskId: task.id,
    agent: agentId,
    runId
  };
  await mkdir(sessionDir, { recursive: true });
  const agentConfig = await readAgent(agentId, root);
  const configuredSkills = await Promise.all((agentConfig?.skills || task.skills?.active || []).map((skillId) => readSkill(skillId, root)));
  let instructions = "";
  if (agentConfig?.instructionsPath) {
    try {
      instructions = await readFile(join(p.settings, "agents", agentConfig.instructionsPath), "utf8");
    } catch {
      instructions = "";
    }
  }
  let description = "";
  try {
    description = await readFile(join(p.tasks, task.id, "description.md"), "utf8");
  } catch {
    description = "";
  }
  const prompt = [
    instructions,
    `# Task ${task.id}`,
    task.title,
    description,
    previousSummary ? `# Previous Session Summary\n\n${previousSummary}` : ""
  ].filter(Boolean).join("\n\n");
  const adapter = await startPiSession({
    task,
    agentId,
    runId,
    cwd: task.worktree?.path || task.worktree?.branch || task.id,
    sessionDir,
    prompt,
    previousSessionFile: previousSessionRef ? join(p.root, previousSessionRef) : undefined,
    instructionsPath: agentConfig?.instructionsPath,
    skills: configuredSkills.filter(Boolean)
  });
  await appendJsonl(join(sessionDir, "session.jsonl"), started);
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.config", actor: "orchestrator", taskId: task.id, runId, agent: agentConfig, skills: configuredSkills.filter(Boolean), resume: { previousSessionRef, previousSummaryRef } });
  await appendJsonl(join(sessionDir, "session.jsonl"), { ts: new Date().toISOString(), type: "agent.adapter", actor: "orchestrator", taskId: task.id, runId, adapter });
  return { runId, agentId, sessionRef, summaryRef, previousSessionRef, previousSummaryRef, event: started, adapter };
}

export async function interruptRun(task, root, mode = "soft") {
  const p = paths(root);
  const agentId = task.routing?.currentAgent || task.agent?.currentAgent || "assistant";
  const runId = task.agent?.currentRunId || null;
  const event = {
    ts: new Date().toISOString(),
    type: "agent.interrupted",
    actor: "orchestrator",
    taskId: task.id,
    agent: agentId,
    runId,
    mode
  };
  await appendJsonl(join(p.runtime, "sessions", task.id, agentId, "session.jsonl"), event);
  return event;
}

export async function writeRunSummary(task, root, runId, summary) {
  const p = paths(root);
  const summaryPath = join(p.tasks, task.id, "summaries", `run-${runId}.md`);
  await writeAtomic(summaryPath, `# Run ${runId}\n\n${summary || "Sem resumo."}\n`);
  return join("summaries", `run-${runId}.md`);
}
