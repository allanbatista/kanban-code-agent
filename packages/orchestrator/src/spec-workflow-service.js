import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonl, getTask, listTaskFiles, normalizeColumnId, paths, readJsonl, updateTask, writeTaskFile } from "@kca/fsdb";
import { appendChatMessage } from "@kca/fsdb/chat-store";
import { releaseSemaphoreLeases } from "@kca/fsdb/runtime-store";
import { roleById } from "@kca/core/roles";
import { TaskSchema } from "@kca/schemas";

const GATE_KEYS = ["spec", "clarification", "definitionOfReady", "validation", "definitionOfDone"];
const ARTIFACTS = {
  taskSpec: "task-spec.md",
  acceptance: "acceptance.md",
  technicalPlan: "technical-plan.md",
  implementationTasks: "implementation-tasks.md",
  validationReport: "validation-report.md",
  reviewReport: "review-report.md",
  deploymentReport: "deployment-report.md",
  summary: "summary.md",
  decisionLog: "decision-log.md",
  handoffsDir: "handoffs"
};

function roleColumn(roleId) {
  if (roleId === "none") return "done";
  return roleById(roleId)?.columnIds?.[0] || normalizeColumnId(roleId);
}

function roleAgent(roleId) {
  return roleById(roleId)?.agentId || roleId;
}

export function phaseForRole(roleId) {
  const map = {
    manager: "intake",
    product: "spec",
    design: "planning",
    architecture: "planning",
    generalist: "execution",
    engineering: "execution",
    qa: "validation",
    quality: "validation",
    review: "review",
    deployment: "delivery",
    documentation: "delivery",
    none: "done"
  };
  return map[roleId] || "intake";
}

function emptyGate(status = "pending", reason = "", evidence = []) {
  return { status, reason, evidence };
}

export function normalizeWorkflow(task) {
  const workflow = task.workflow || {};
  const gates = { ...(workflow.gates || {}) };
  for (const key of GATE_KEYS) gates[key] = { ...emptyGate(), ...(gates[key] || {}) };
  return {
    phase: workflow.phase || phaseForRole(task.routing?.currentRole || task.routing?.currentAgent || "manager"),
    currentRole: workflow.currentRole || task.routing?.currentRole || task.routing?.currentAgent || "manager",
    boardColumn: workflow.boardColumn || task.column || "manager",
    gates,
    artifacts: { ...ARTIFACTS, ...(workflow.artifacts || {}) }
  };
}

function gate(status, reason, evidence, updatedBy) {
  return {
    status,
    reason,
    evidence: Array.isArray(evidence) ? evidence : [evidence].filter(Boolean),
    updatedAt: new Date().toISOString(),
    updatedBy
  };
}

function withGate(workflow, key, value) {
  return { ...workflow, gates: { ...workflow.gates, [key]: value } };
}

function routePatch(current, roleId, extra = {}) {
  if (roleId === "none") {
    return {
      ...extra,
      status: "done",
      column: "done",
      routing: {
        ...current.routing,
        lastAgent: current.routing?.currentAgent || null,
        lastRole: current.routing?.currentRole || null,
        currentAgent: null,
        currentRole: null
      }
    };
  }
  const workflow = extra.workflow ? {
    ...extra.workflow,
    currentRole: current.workflow?.currentRole || current.routing?.currentRole || current.routing?.currentAgent || "manager",
    boardColumn: current.column
  } : undefined;
  return {
    ...extra,
    status: extra.status || "queued",
    column: current.column,
    routing: current.routing,
    ...(workflow ? { workflow } : {})
  };
}

const TERMINAL_STATUSES = new Set(["done", "canceled"]);

function parentIdForTask(task) {
  return task?.parentTaskId || task?.worktree?.parentTaskId || null;
}

function isSubtask(task) {
  return Boolean(parentIdForTask(task));
}

async function requeueParentForSubtaskDecision(child, root, disposition, text) {
  const parentTaskId = parentIdForTask(child);
  if (!parentTaskId) return null;
  const parent = await getTask(parentTaskId, root);
  if (!parent) return null;
  await appendChatMessage(root, { scope: "task", taskId: parentTaskId, role: "assistant", persona: "orchestrator", agentId: "orchestrator", disposition, text, visibility: "both" });
  await appendJsonl(`${paths(root).tasks}/${parentTaskId}/events.jsonl`, { ts: new Date().toISOString(), type: disposition, actor: "orchestrator", taskId: parentTaskId, subtaskId: child.id });
  if (TERMINAL_STATUSES.has(parent.status) || parent.status === "queued") return parent;
  return TaskSchema.parse(await updateTask(parentTaskId, { status: "queued", column: parent.column, routing: parent.routing }, root, disposition));
}

function mdList(items = []) {
  return items.length ? items.map((item) => `- ${typeof item === "string" ? item : JSON.stringify(item)}`).join("\n") : "- None";
}

function markdownReport(title, sections = []) {
  return [
    `# ${title}`,
    "",
    ...sections.flatMap(([heading, value]) => [
      `## ${heading}`,
      "",
      Array.isArray(value) ? mdList(value) : String(value || "Not recorded."),
      ""
    ])
  ].join("\n");
}

async function readTaskText(root, taskId, file) {
  try {
    return await readFile(join(paths(root).tasks, taskId, file), "utf8");
  } catch {
    return "";
  }
}

async function appendTaskMarkdown(root, taskId, file, text) {
  const previous = await readTaskText(root, taskId, file);
  await writeTaskFile(taskId, file, `${previous}${previous.trim() ? "\n\n" : ""}${text}`, root);
}

async function taskFilesSet(root, taskId) {
  return new Set(await listTaskFiles(taskId, root));
}

function approvedAcceptance(summary) {
  return [
    "# Critérios de aceite",
    "",
    summary,
    ""
  ].join("\n");
}

function specHasReadyShape(spec, { approved: gateApproved = false } = {}) {
  const text = String(spec || "");
  const normalized = text.replace(/\*\*/g, "");
  const approved = gateApproved || /^status:\s*approved\b/im.test(normalized);
  const noBlockingQuestions = /(open questions?|blocking questions?|quest(?:ões|oes) de bloqueio|bloqueio|d[uú]vidas?|perguntas?)[\s\S]{0,160}(none|nenhum|nenhuma|resolved|resolvid)/i.test(text);
  const hasPlaceholder = /(^|\n)\s*- \[ \].*(\bTBD\b|\bTODO\b|a definir)|\bTBD\b|\bTODO\b|\?\?/i.test(text);
  return text.length >= 80
    && /(acceptance|crit[eé]rios?|criterios?|AC-?\d)/i.test(text)
    && /(scope|escopo|deliverables?|entreg[aá]veis?|objective|objetivo|problem statement)/i.test(text)
    && /(depend[eê]nc|dependenc|constraints?|restri[cç][oõ]es?)/i.test(text)
    && (approved || /(decision|decis|decis[aã]o|decisões|decisoes)/i.test(text))
    && !hasPlaceholder
    && (approved || noBlockingQuestions);
}

function validationCriteriaLines(criteria = [], evidence = []) {
  const rows = criteria.length ? criteria : ["Critério não informado"];
  return rows.map((criterion, index) => {
    const value = typeof criterion === "string" ? criterion : JSON.stringify(criterion);
    const proof = evidence[index] ?? evidence[0] ?? "sem evidência";
    return `- ${value}: ${typeof proof === "string" ? proof : JSON.stringify(proof)}`;
  }).join("\n");
}

export async function createTaskSpecWorkflow(command, current, root) {
  await writeTaskFile(command.taskId, ARTIFACTS.taskSpec, command.content, root);
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "spec", gate("pending", `${command.kind} spec created; awaiting Manager approval.`, [ARTIFACTS.taskSpec], "product"));
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    workflow: { ...workflow, phase: "spec", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.spec.created"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.spec.created", actor: "product", taskId: command.taskId, runId: command.runId, kind: command.kind, artifact: ARTIFACTS.taskSpec });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.taskSpec };
}

export async function updateTaskSpecWorkflow(command, current, root) {
  await writeTaskFile(command.taskId, ARTIFACTS.taskSpec, command.content, root);
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "spec", gate("pending", command.reason || "Spec updated; approval required.", [ARTIFACTS.taskSpec], "product"));
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    workflow: { ...workflow, phase: "spec", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.spec.updated"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.spec.updated", actor: "product", taskId: command.taskId, runId: command.runId, reason: command.reason || "", artifact: ARTIFACTS.taskSpec });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.taskSpec };
}

export async function approveTaskSpecWorkflow(command, current, root) {
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "spec", gate("passed", command.summary, [ARTIFACTS.taskSpec], command.approvedByRole));
  if (workflow.gates.definitionOfReady.status !== "passed") {
    workflow = withGate(workflow, "definitionOfReady", gate("pending", "Spec approved; DoR must be rerun.", [ARTIFACTS.taskSpec], command.approvedByRole));
  }
  await writeTaskFile(command.taskId, ARTIFACTS.acceptance, approvedAcceptance(command.summary), root);
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    workflow: { ...workflow, phase: "planning", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.spec.approved"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.spec.approved", actor: command.approvedByRole, taskId: command.taskId, runId: command.runId, summary: command.summary });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.taskSpec };
}

export async function recordDecisionWorkflow(command, current, root) {
  const entry = [
    `## ${new Date().toISOString()} - ${command.role}`,
    "",
    `Decision: ${command.decision}`,
    "",
    `Rationale: ${command.rationale || "Not provided."}`,
    "",
    `Confirmed by: ${command.confirmedBy || "not recorded"}`,
    ""
  ].join("\n");
  await appendTaskMarkdown(root, command.taskId, ARTIFACTS.decisionLog, entry);
  const task = TaskSchema.parse(await updateTask(command.taskId, { workflow: normalizeWorkflow(current) }, root, "workflow.decision_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.decision_recorded", actor: command.role, taskId: command.taskId, runId: command.runId, decision: command.decision, rationale: command.rationale, confirmedBy: command.confirmedBy || null });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.decisionLog };
}

export async function recordHandoffWorkflow(command, current, root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactPath = `${ARTIFACTS.handoffsDir}/${stamp}-${command.fromRole}-to-${command.toRole}.md`;
  const content = [
    `# Handoff: ${command.fromRole} -> ${command.toRole}`,
    "",
    `Reason: ${command.reason || "not recorded"}`,
    "",
    "## Context",
    "",
    command.context || "Not recorded.",
    "",
    "## Artifacts",
    "",
    mdList(command.artifacts),
    "",
    "## Decisions",
    "",
    mdList(command.decisions),
    "",
    "## Open Questions",
    "",
    mdList(command.openQuestions),
    "",
    "## Success Criteria",
    "",
    mdList(command.successCriteria),
    "",
    "## Restrictions",
    "",
    mdList(command.restrictions),
    "",
    `Next action: ${command.nextAction || "not recorded"}`,
    ""
  ].join("\n");
  await writeTaskFile(command.taskId, artifactPath, content, root);
  const toRole = command.toRole === "qa" ? "quality" : command.toRole;
  const workflow = { ...normalizeWorkflow(current), phase: phaseForRole(toRole), currentRole: command.toRole, boardColumn: roleColumn(toRole) };
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, toRole, { workflow }), root, "workflow.handoff_recorded"));
  const event = { ts: new Date().toISOString(), type: "role.handoff", actor: command.fromRole, taskId: command.taskId, runId: command.runId, fromRole: command.fromRole, toRole: command.toRole, reason: command.reason, artifactPath };
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, event);
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ...event, type: "workflow.handoff_recorded" });
  return { ok: true, commandId: command.commandId, task, artifactPath };
}

export async function recordValidationWorkflow(command, current, root) {
  const content = [
    "# Validation Report",
    "",
    command.summary || "Validation recorded.",
    "",
    "## Acceptance Criteria Evidence",
    "",
    validationCriteriaLines(command.criteria, command.evidence),
    ""
  ].join("\n");
  await writeTaskFile(command.taskId, ARTIFACTS.validationReport, content, root);
  const passed = command.criteria.length > 0 && command.evidence.length > 0;
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "validation", gate(passed ? "passed" : "failed", command.summary || (passed ? "Validation evidence recorded." : "Validation requires criteria and evidence."), [ARTIFACTS.validationReport, ...command.evidence], "qa"));
  if (passed && isSubtask(current)) {
    const task = TaskSchema.parse(await updateTask(command.taskId, {
      status: "waiting_review",
      column: current.column,
      routing: current.routing,
      agent: current.agent,
      workflow: { ...workflow, phase: "review", currentRole: current.workflow?.currentRole || current.routing?.currentRole || current.routing?.currentAgent || "qa", boardColumn: current.column }
    }, root, "subtask.review_requested"));
    const text = `Subtask aguardando review: ${task.id}. Validação registrada em ${ARTIFACTS.validationReport}. Resultado: ${command.summary || "Validation evidence recorded."}`;
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.validation_recorded", actor: "qa", taskId: command.taskId, runId: command.runId, criteria: command.criteria, evidence: command.evidence });
    await appendChatMessage(root, { scope: "task", taskId: command.taskId, role: "assistant", persona: current.routing?.currentRole || current.routing?.currentAgent || "qa", agentId: current.routing?.currentAgent || "qa", runId: command.runId, disposition: "subtask.review_requested", text, visibility: "both" });
    await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "subtask.review_requested", actor: current.routing?.currentRole || current.routing?.currentAgent || "qa", taskId: command.taskId, parentTaskId: parentIdForTask(current), summary: command.summary || "", resultPath: ARTIFACTS.validationReport });
    const parentTask = await requeueParentForSubtaskDecision(task, root, "subtask.review_requested", text);
    await releaseSemaphoreLeases({ root, taskId: command.taskId });
    return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.validationReport, parentTask, reviewPending: true };
  }
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, passed ? "review" : "quality", {
    workflow: { ...workflow, phase: passed ? "review" : "validation", currentRole: passed ? "review" : "qa", boardColumn: passed ? "review" : "quality" }
  }), root, "workflow.validation_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.validation_recorded", actor: "qa", taskId: command.taskId, runId: command.runId, criteria: command.criteria, evidence: command.evidence });
  return { ok: passed, commandId: command.commandId, task, artifactPath: ARTIFACTS.validationReport };
}

export async function recordTechnicalPlanWorkflow(command, current, root) {
  const content = command.content || markdownReport("Technical Plan", [["Summary", command.summary]]);
  await writeTaskFile(command.taskId, ARTIFACTS.technicalPlan, content, root);
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "definitionOfReady", gate("pending", command.required ? "Technical plan recorded; DoR must be rerun." : "Technical plan recorded as optional evidence.", [ARTIFACTS.technicalPlan], "architecture"));
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    workflow: { ...workflow, phase: "planning", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.technical_plan_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.technical_plan_recorded", actor: "architecture", taskId: command.taskId, runId: command.runId, artifact: ARTIFACTS.technicalPlan, required: command.required, summary: command.summary || "" });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.technicalPlan };
}

export async function recordImplementationTasksWorkflow(command, current, root) {
  const content = command.content || markdownReport("Implementation Tasks", [["Tasks", command.tasks]]);
  await writeTaskFile(command.taskId, ARTIFACTS.implementationTasks, content, root);
  const task = TaskSchema.parse(await updateTask(command.taskId, { workflow: normalizeWorkflow(current) }, root, "workflow.implementation_tasks_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.implementation_tasks_recorded", actor: current.routing?.currentRole || "manager", taskId: command.taskId, runId: command.runId, artifact: ARTIFACTS.implementationTasks, tasks: command.tasks || [] });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.implementationTasks };
}

export async function recordReviewReportWorkflow(command, current, root) {
  const content = markdownReport("Review Report", [
    ["Status", command.status],
    ["Summary", command.summary],
    ["Findings", command.findings],
    ["Evidence", command.evidence]
  ]);
  await writeTaskFile(command.taskId, ARTIFACTS.reviewReport, content, root);
  const passed = ["passed", "not_applicable"].includes(command.status);
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, passed ? "manager" : "engineering", {
    status: passed ? "waiting" : "queued",
    workflow: { ...normalizeWorkflow(current), phase: passed ? "review" : "execution", currentRole: passed ? "manager" : "engineering", boardColumn: passed ? "manager" : "engineering" }
  }), root, "workflow.review_report_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.review_report_recorded", actor: "review", taskId: command.taskId, runId: command.runId, artifact: ARTIFACTS.reviewReport, status: command.status, summary: command.summary || "", findings: command.findings || [], evidence: command.evidence || [] });
  return { ok: passed, commandId: command.commandId, task, artifactPath: ARTIFACTS.reviewReport };
}

export async function recordDeploymentReportWorkflow(command, current, root) {
  const content = markdownReport("Deployment Report", [
    ["Status", command.status],
    ["Summary", command.summary],
    ["Environment", command.environment || "not recorded"],
    ["Version", command.version || "not recorded"],
    ["Evidence", command.evidence]
  ]);
  await writeTaskFile(command.taskId, ARTIFACTS.deploymentReport, content, root);
  const passed = ["passed", "not_applicable"].includes(command.status);
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    status: "waiting",
    workflow: { ...normalizeWorkflow(current), phase: "delivery", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.deployment_report_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.deployment_report_recorded", actor: "deployment", taskId: command.taskId, runId: command.runId, artifact: ARTIFACTS.deploymentReport, status: command.status, summary: command.summary || "", environment: command.environment || "", version: command.version || "", evidence: command.evidence || [] });
  return { ok: passed, commandId: command.commandId, task, artifactPath: ARTIFACTS.deploymentReport };
}

export async function recordSummaryWorkflow(command, current, root) {
  const content = markdownReport("Task Summary", [
    ["Summary", command.summary],
    ["Evidence", command.evidence]
  ]);
  await writeTaskFile(command.taskId, ARTIFACTS.summary, content, root);
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, "manager", {
    status: "waiting",
    workflow: { ...normalizeWorkflow(current), phase: "review", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.summary_recorded"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.summary_recorded", actor: "manager", taskId: command.taskId, runId: command.runId, artifact: ARTIFACTS.summary, summary: command.summary, evidence: command.evidence || [] });
  return { ok: true, commandId: command.commandId, task, artifactPath: ARTIFACTS.summary };
}

function requiresTechnicalPlan(task) {
  return (task.projectTargets || []).length > 0 && task.kind !== "subtask";
}

export async function runDefinitionOfReadyGateWorkflow(command, current, root) {
  const spec = await readTaskText(root, command.taskId, ARTIFACTS.taskSpec);
  const workflow = normalizeWorkflow(current);
  const files = await taskFilesSet(root, command.taskId);
  const missing = [];
  if (workflow.gates.spec.status !== "passed" || !specHasReadyShape(spec, { approved: workflow.gates.spec.status === "passed" })) missing.push("approved ready task-spec.md");
  if (requiresTechnicalPlan(current) && !files.has(ARTIFACTS.technicalPlan)) missing.push("technical-plan.md");
  const passed = missing.length === 0;
  const reason = passed
    ? "Approved spec and required planning evidence are ready for execution."
    : `DoR missing: ${missing.join(", ")}.`;
  const next = withGate(workflow, "definitionOfReady", gate(passed ? "passed" : "failed", reason, [ARTIFACTS.taskSpec, ARTIFACTS.technicalPlan], "manager"));
  const passedRole = current.kind === "master" ? "manager" : "engineering";
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, passed ? passedRole : "product", {
    workflow: { ...next, phase: passed ? phaseForRole(passedRole) : "spec", currentRole: passed ? passedRole : "product", boardColumn: passed ? roleColumn(passedRole) : "product" }
  }), root, passed ? "gate.passed" : "gate.failed"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.dor_checked", actor: "manager", taskId: command.taskId, runId: command.runId, gate: "definitionOfReady", status: passed ? "passed" : "failed", reason });
  return { ok: passed, commandId: command.commandId, task, gate: task.workflow.gates.definitionOfReady };
}

async function hasReviewEvidence(root, taskId, events, files) {
  if (events.some((event) => event.type === "workflow.review_report_recorded" && ["passed", "not_applicable"].includes(event.status))) return true;
  if (events.some((event) => event.type === "gate.passed" && (event.gate === "review" || event.review))) return true;
  if (files.has(ARTIFACTS.reviewReport)) return true;
  return [...files].some((file) => /^artifacts\/review-\d+\.json$/.test(file));
}

function hasDeploymentEvidence(events, files) {
  return events.some((event) => event.type === "deployment.recorded" || (event.type === "workflow.deployment_report_recorded" && ["passed", "not_applicable"].includes(event.status)))
    || files.has(ARTIFACTS.deploymentReport);
}

function hasHandoffEvidence(events, files) {
  return events.some((event) => event.type === "role.handoff" || event.type === "workflow.handoff_recorded")
    || [...files].some((file) => file.startsWith(`${ARTIFACTS.handoffsDir}/`));
}

async function hasDocumentationDecision(root, taskId, events, files) {
  if (events.some((event) => event.type === "workflow.decision_recorded" && /doc|documentation/i.test(String(event.decision || "")))) return true;
  if (!files.has(ARTIFACTS.decisionLog)) return false;
  return /doc|documentation/i.test(await readTaskText(root, taskId, ARTIFACTS.decisionLog));
}

export async function runDefinitionOfDoneGateWorkflow(command, current, root) {
  const workflow = normalizeWorkflow(current);
  const files = await taskFilesSet(root, command.taskId);
  const events = await readJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`);
  const missing = [];
  if (workflow.gates.spec.status !== "passed") missing.push("spec gate");
  if (workflow.gates.definitionOfReady.status !== "passed") missing.push("Definition of Ready");
  if (workflow.gates.validation.status !== "passed" || !files.has(ARTIFACTS.validationReport)) missing.push("validation report");
  if (!(await hasReviewEvidence(root, command.taskId, events, files))) missing.push("review evidence");
  if (!hasDeploymentEvidence(events, files)) missing.push("deployment evidence");
  if (!files.has(ARTIFACTS.summary)) missing.push("summary.md");
  if (!events.some((event) => event.type === "workflow.decision_recorded") || !files.has(ARTIFACTS.decisionLog)) missing.push("decision log");
  if (!hasHandoffEvidence(events, files)) missing.push("handoff evidence");
  if (!(await hasDocumentationDecision(root, command.taskId, events, files))) missing.push("documentation decision");
  const passed = missing.length === 0;
  const reason = passed ? "Definition of Done passed with spec, DoR, validation, review, delivery, summary, decisions, handoffs, and documentation decision." : `DoD missing: ${missing.join(", ")}.`;
  const next = withGate(workflow, "definitionOfDone", gate(passed ? "passed" : "failed", reason, [ARTIFACTS.taskSpec, ARTIFACTS.validationReport, ARTIFACTS.summary], "manager"));
  const task = TaskSchema.parse(await updateTask(command.taskId, routePatch(current, passed ? "none" : "manager", {
    status: passed ? "done" : "waiting",
    workflow: { ...next, phase: passed ? "done" : "review", currentRole: passed ? "none" : "manager", boardColumn: passed ? "done" : "manager" }
  }), root, passed ? "gate.passed" : "gate.failed"));
  await appendJsonl(`${paths(root).tasks}/${command.taskId}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.dod_checked", actor: "manager", taskId: command.taskId, runId: command.runId, gate: "definitionOfDone", status: passed ? "passed" : "failed", reason, missing });
  await releaseSemaphoreLeases({ root, taskId: command.taskId });
  return { ok: passed, commandId: command.commandId, task, gate: task.workflow.gates.definitionOfDone, missing };
}

export async function requestDoneReview(current, root, { runId, summary, source = "direct_done_request" } = {}) {
  let workflow = normalizeWorkflow(current);
  workflow = withGate(workflow, "definitionOfDone", gate("pending", "Completion requested; Manager must run Definition of Done.", [summary || source], current.routing?.currentRole || "agent"));
  const task = TaskSchema.parse(await updateTask(current.id, routePatch(current, "manager", {
    status: "waiting",
    agent: current.agent,
    workflow: { ...workflow, phase: "review", currentRole: "manager", boardColumn: "manager" }
  }), root, "workflow.done_requested"));
  await appendJsonl(`${paths(root).tasks}/${current.id}/events.jsonl`, { ts: new Date().toISOString(), type: "workflow.done_requested", actor: current.routing?.currentRole || "agent", taskId: current.id, runId, source, summary: summary || "" });
  await appendChatMessage(root, { scope: "task", taskId: current.id, role: "assistant", persona: "manager", agentId: "manager", runId, disposition: "workflow.done_requested", text: summary || "Completion requested. Manager must run Definition of Done.", visibility: "both" });
  return task;
}

export async function latestTask(taskId, root) {
  const task = await getTask(taskId, root);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}
