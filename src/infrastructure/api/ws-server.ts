import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Orquestrator } from '../../application/orquestrator.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { TaskMetadata } from '../../domain/task.js';

// --- Message Types ---

interface ClientMessage {
  type: 'subscribe';
  taskId?: string;
}

interface ServerEventMessage {
  type: 'event';
  event: SwarmEvent;
  // Current metadata of the event's task, so the client applies the change
  // incrementally (no full refetch). Absent when the task no longer exists
  // (e.g. archived) — the client then removes it.
  task?: TaskMetadata;
}

interface ServerStateMessage {
  type: 'state';
  tasks: TaskMetadata[];
}

// --- Connected Client ---

interface ConnectedClient {
  socket: WebSocket;
  subscribedTaskId?: string;
}

export function registerWebSocket(
  fastify: FastifyInstance,
  orquestrator: Orquestrator,
): void {
  const clients = new Set<ConnectedClient>();

  fastify.get(
    '/ws',
    { websocket: true },
    (socket: WebSocket, _request) => {
      const client: ConnectedClient = { socket };
      clients.add(client);

      // Ensure socket.send exists before using it
      if (typeof socket.send !== 'function') {
        console.error('WebSocket socket missing send method');
        clients.delete(client);
        return;
      }

      // Send full state on connect (auto-reconnect friendly)
      const tasks = [...orquestrator.tasks.values()].map((t) => orquestrator.toMetadata(t));
      const stateMessage: ServerStateMessage = { type: 'state', tasks };
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(stateMessage));
      }

      // Handle incoming messages
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const message: ClientMessage = JSON.parse(raw.toString());

          if (message.type === 'subscribe') {
            client.subscribedTaskId = message.taskId;
            // Re-send state scoped to subscription
            const filtered = message.taskId
              ? [orquestrator.tasks.get(message.taskId)]
                  .filter(Boolean)
                  .map((t) => orquestrator.toMetadata(t!))
              : tasks;
            const scopedState: ServerStateMessage = { type: 'state', tasks: filtered };
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify(scopedState));
            }
          }
        } catch {
          // Ignore malformed messages
        }
      });

      // Handle disconnect
      socket.on('close', () => {
        clients.delete(client);
      });

      socket.on('error', () => {
        clients.delete(client);
      });
    },
  );

  // Broadcast events to subscribed clients on state change
  orquestrator.on('state:changed', () => {
    const latestEvent = orquestrator.events[orquestrator.events.length - 1];
    if (!latestEvent) return;

    const affected = latestEvent.taskId
      ? orquestrator.tasks.get(latestEvent.taskId)
      : undefined;
    const eventMessage: ServerEventMessage = {
      type: 'event',
      event: latestEvent,
      task: affected ? orquestrator.toMetadata(affected) : undefined,
    };
    const data = JSON.stringify(eventMessage);

    for (const client of clients) {
      if (client.socket.readyState !== client.socket.OPEN) {
        clients.delete(client);
        continue;
      }

      // Filter by subscription
      if (
        client.subscribedTaskId &&
        latestEvent.taskId !== client.subscribedTaskId &&
        latestEvent.parentId !== client.subscribedTaskId
      ) {
        continue;
      }

      try {
        client.socket.send(data);
      } catch {
        clients.delete(client);
      }
    }
  });
}
