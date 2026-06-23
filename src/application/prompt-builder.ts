import type { Task, TaskChatMessage, TaskMetadata } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { TaskRun } from '../domain/run.js';

/**
 * Idempotent prompt builder — pure function, same input produces same output.
 * No chat mutation, no side effects.
 */
export function buildPrompt(
  task: Task,
  metadata: TaskMetadata,
  triggerEvents: SwarmEvent[],
  maxPromptChatMessages: number,
): string {
  const subtaskResults = (metadata.runs.length > 0
    ? task.subtaskIds
        .map((sid) => ({ id: sid, title: task.options.title, assignedTo: '' }))
    : []) as Array<{ id: string; title: string; assignedTo: string }>;

  // Rebuild subtaskResults from the task's subtaskIds and the passed metadata
  // We don't have access to the tasks Map here, so we build from what metadata gives us.
  // The Orquestrator will enrich this. For now, use the runs wait groups to infer.
  const subtaskLines: string[] = [];
  if (task.subtaskIds.length > 0) {
    // We need access to subtask statuses — the orquestrator passes this via metadata
    // For a pure function approach, we rely on the metadata.taskChat events that
    // contain subtask creation events. The orquestrator will wrap this.
  }

  // Format subtask results from task's own data (we know subtask IDs but not their statuses)
  // The Orquestrator.getSubtasks provides the actual subtask objects.
  // This is a pure function so we receive subtask statuses as formatted strings.
  const subtaskSummary = ''; // Will be filled by the Orquestrator wrapper

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
    metadata.canCreateSubtasks
      ? `Subtasks:\n${_buildSubtaskLines(task, metadata)}`
      : 'Sem subtasks.',
    `Runs:\n${runSummary}`,
    `Task chat:\n${chatTail.map(formatChatMessage).join('\n')}`,
    task.piSessionFile
      ? `Sessao Pi persistida: ${task.piSessionFile}`
      : 'Sem sessao Pi persistida.',
    'Continue a partir do historico anterior da sessao, decida o proximo passo e retorne somente o JSON estruturado.',
  ].join('\n\n');
}

function _buildSubtaskLines(task: Task, metadata: TaskMetadata): string {
  // Subtask IDs are on the task; their statuses come from metadata
  // Since this is a pure function and we don't have the tasks map here,
  // we use metadata.runs to infer or show IDs only.
  if (task.subtaskIds.length === 0) return 'Sem subtasks.';

  // We use the runs wait groups to reconstruct which tasks were waited on
  const subtaskRefs: string[] = [];
  for (const run of task.runs) {
    for (const group of run.waitGroups) {
      for (const tid of group.taskIds) {
        subtaskRefs.push(`- ${tid} [status unknown]`);
      }
    }
  }
  if (subtaskRefs.length === 0) {
    subtaskRefs.push(
      ...task.subtaskIds.map((tid) => `- ${tid} [status unknown]`),
    );
  }
  return subtaskRefs.join('\n');
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
