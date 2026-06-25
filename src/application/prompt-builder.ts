import type { Task, TaskChatMessage, TaskMetadata } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { ScopeSpecItem, ProgressLogEntry, EnvResume } from '../infrastructure/persistence/task-file-store.js';
import { MICRO_CYCLE_INSTRUCTION, chooseContextStrategy } from './context-router.js';

/**
 * Idempotent prompt builder — pure function, same input produces same output.
 * No chat mutation, no side effects. Subtask status/results come pre-formatted
 * in `metadata.subtaskSummary` (Orquestrator owns the tasks map).
 */
export function buildPrompt(
  task: Task,
  metadata: TaskMetadata,
  triggerEvents: SwarmEvent[],
  maxPromptChatMessages: number,
  continuity?: {
    scopeSpec?: ScopeSpecItem[];
    progressLog?: ProgressLogEntry[];
    envResume?: EnvResume | null;
  },
): string {
  const eventSummary = triggerEvents.length
    ? triggerEvents
        .map((event) => {
          const verb =
            event.type === 'TASK_FAILED'
              ? 'falhou'
              : event.type === 'TASK_CANCELLED'
                ? 'cancelada'
                : 'concluida';
          const msgs = formatMessages(event.messages ?? []);
          return `- ${event.eventId}: run ${event.runId ?? '-'} wait ${event.waitId ?? '-'} task ${event.taskId ?? '-'} ${verb}. mensagens: ${msgs}. payload=${JSON.stringify(event.payload ?? {})}`;
        })
        .join('\n')
    : 'inicio ou retomada sem novo evento.';

  const runSummary = task.runs.length
    ? task.runs
        .map((run) => {
          const groups = run.waitGroups
            .map(
              (group) =>
                `${group.waitId}/${group.mode}/${group.status} tasks=${group.taskIds.join(',')} processed=${group.processedEventIds.join(',')}`,
            )
            .join(' ; ');
          return `- ${run.runId} (epoch ${run.epoch}) [${run.status}]: ${groups}`;
        })
        .join('\n')
    : 'Sem runs.';

  const chatTail = task.chat.slice(-maxPromptChatMessages);
  // State-dependent context routing (§3.4): when the chat overflows the tail
  // budget we compact in-place — surface a marker for the omitted prefix instead
  // of silently dropping it (the durable detail lives in scope-spec/progress-log).
  const omittedCount = task.chat.length - chatTail.length;
  const strategy = chooseContextStrategy(task.chat.length, maxPromptChatMessages);

  const sections = [
    `Tarefa: ${task.options.title}`,
    `Eventos recebidos:\n${eventSummary}`,
    task.subtaskIds.length > 0
      ? `Subtasks:\n${metadata.subtaskSummary ?? 'Sem subtasks.'}`
      : 'Sem subtasks.',
    `Runs:\n${runSummary}`,
  ];

  // Continuity artifacts (selective rehydration)
  if (continuity?.scopeSpec?.length) {
    const specLines = continuity.scopeSpec.map(
      (item) => `- [${item.satisfied ? 'x' : ' '}] ${item.id}: ${item.description}`,
    );
    sections.push(`Scope-Spec (checklist de escopo):\n${specLines.join('\n')}`);
  }

  if (continuity?.progressLog?.length) {
    const logLines = continuity.progressLog.slice(-5).map(
      (entry) => `- ${entry.ts} epoch=${entry.epoch ?? '-'} ${entry.action}: ${entry.detail ?? ''}`,
    );
    sections.push(`Progresso recente:\n${logLines.join('\n')}`);
  }

  if (continuity?.envResume) {
    const resume = continuity.envResume;
    const parts = [];
    if (resume.testCommand) parts.push(`Teste: ${resume.testCommand}`);
    if (resume.buildCommand) parts.push(`Build: ${resume.buildCommand}`);
    if (resume.notes) parts.push(`Notas: ${resume.notes}`);
    sections.push(`Ambiente:\n${parts.join('\n')}`);
  }

  const chatHeader =
    strategy === 'compact' && omittedCount > 0
      ? `Task chat (${omittedCount} mensagens anteriores compactadas — detalhe no scope-spec/progress-log acima):`
      : 'Task chat:';
  sections.push(
    `${chatHeader}\n${chatTail.map(formatChatMessage).join('\n')}`,
    MICRO_CYCLE_INSTRUCTION,
    'Decida o proximo passo e retorne somente o JSON estruturado.',
  );

  return sections.join('\n\n');
}

function formatChatMessage(message: TaskChatMessage): string {
  const attachments = message.attachments?.length
    ? ` attachments=${message.attachments.map((a) => a.path).join(',')}`
    : '';
  const artifacts = message.artifacts?.length
    ? ` artifacts=${message.artifacts.map((a) => a.path).join(',')}`
    : '';
  const eventId = message.eventId ? ` eventId=${message.eventId}` : '';
  return `- ${message.ts} ${message.role}/${message.type}: ${message.text ?? ''}${attachments}${artifacts}${eventId}`;
}

function formatMessages(messages: TaskChatMessage[]): string {
  return messages
    .map((message) => `${message.role}/${message.type}: ${message.text ?? ''}`)
    .join(' | ');
}
