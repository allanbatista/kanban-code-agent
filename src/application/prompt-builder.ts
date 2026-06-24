import type { Task, TaskChatMessage, TaskMetadata } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';

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
          return `- ${run.runId} [${run.status}]: ${groups}`;
        })
        .join('\n')
    : 'Sem runs.';

  const chatTail = task.chat.slice(-maxPromptChatMessages);

  return [
    `Tarefa: ${task.options.title}`,
    `Eventos recebidos:\n${eventSummary}`,
    task.subtaskIds.length > 0
      ? `Subtasks:\n${metadata.subtaskSummary ?? 'Sem subtasks.'}`
      : 'Sem subtasks.',
    `Runs:\n${runSummary}`,
    `Task chat:\n${chatTail.map(formatChatMessage).join('\n')}`,
    task.piSessionFile
      ? `Sessao Pi persistida: ${task.piSessionFile}`
      : 'Sem sessao Pi persistida.',
    'Continue a partir do historico anterior da sessao, decida o proximo passo e retorne somente o JSON estruturado.',
  ].join('\n\n');
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
