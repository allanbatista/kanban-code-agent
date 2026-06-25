import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Orquestrator } from '../../application/orquestrator.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { TaskMetadata } from '../../domain/task.js';

// Versioned wire contract (F7.T4): bump when the envelope shape changes so the
// contract test (and clients) can detect drift / require a migration.
export const WS_SCHEMA_VERSION = 1;

// --- Message Types ---

// Inbound frames are validated (F8.T2): malformed frames are dropped, not trusted.
const clientMessageSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  taskId: z.string().min(1).max(128).optional(),
  sinceSeq: z.number().int().nonnegative().optional(),
});
type ClientMessage = z.infer<typeof clientMessageSchema>;

interface ServerEventMessage {
  type: 'event';
  schemaVersion: number;
  event: SwarmEvent;
  // Current metadata of the event's task, so the client applies the change
  // incrementally (no full refetch). Absent when the task no longer exists
  // (e.g. archived) — the client then removes it.
  task?: TaskMetadata;
}

interface ServerStateMessage {
  type: 'state';
  schemaVersion: number;
  tasks: TaskMetadata[];
  // Highest seq known to the server, so the client seeds its resume cursor.
  seq: number;
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

  const send = (socket: WebSocket, payload: unknown): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };

  const eventMessage = (event: SwarmEvent): ServerEventMessage => {
    const affected = event.taskId ? orquestrator.tasks.get(event.taskId) : undefined;
    return {
      type: 'event',
      schemaVersion: WS_SCHEMA_VERSION,
      event,
      task: affected ? orquestrator.toMetadata(affected) : undefined,
    };
  };

  const stateMessage = (taskId?: string): ServerStateMessage => {
    const tasks = taskId
      ? [orquestrator.tasks.get(taskId)].filter(Boolean).map((t) => orquestrator.toMetadata(t!))
      : [...orquestrator.tasks.values()].map((t) => orquestrator.toMetadata(t));
    return { type: 'state', schemaVersion: WS_SCHEMA_VERSION, tasks, seq: orquestrator.latestSeq };
  };

  fastify.get(
    '/ws',
    { websocket: true },
    (socket: WebSocket, _request) => {
      const client: ConnectedClient = { socket };
      clients.add(client);

      if (typeof socket.send !== 'function') {
        console.error('WebSocket socket missing send method');
        clients.delete(client);
        return;
      }

      // Send full state on connect (auto-reconnect friendly).
      send(socket, stateMessage());

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          return; // ignore malformed JSON
        }
        const result = clientMessageSchema.safeParse(parsed);
        if (!result.success) return; // ignore frames that violate the contract
        const message: ClientMessage = result.data;
        if (message.type === 'unsubscribe') {
          client.subscribedTaskId = undefined;
          return;
        }
        if (message.type === 'subscribe') {
          client.subscribedTaskId = message.taskId;
          // Catch-up: replay events missed during a disconnect, in seq order,
          // sourced from the durable ledger view (survives server restart).
          if (typeof message.sinceSeq === 'number') {
            const missed = orquestrator.getEventsSince(message.sinceSeq, message.taskId);
            for (const event of missed) send(socket, eventMessage(event));
          }
          // Always (re)send the scoped snapshot so the client reconciles state.
          send(socket, stateMessage(message.taskId));
        }
      });

      socket.on('close', () => clients.delete(client));
      socket.on('error', () => clients.delete(client));
    },
  );

  // Broadcast every recorded event to subscribed clients so the board updates
  // in real time (one push per event, in seq order).
  orquestrator.on('event', (event: SwarmEvent) => {
    if (!event) return;
    const data = JSON.stringify(eventMessage(event));

    for (const client of clients) {
      if (client.socket.readyState !== client.socket.OPEN) {
        clients.delete(client);
        continue;
      }
      if (
        client.subscribedTaskId &&
        event.taskId !== client.subscribedTaskId &&
        event.parentId !== client.subscribedTaskId
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
