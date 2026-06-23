import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';
import { TASK_STATUS } from '../../../domain/types.js';

// ---------------------------------------------------------------------------
// Report Routes
// ---------------------------------------------------------------------------

export function registerReportRoutes(
  fastify: FastifyInstance,
  orquestrator: Orquestrator,
): void {
  // GET /api/report/summary — execution summary across all tasks
  fastify.get('/api/report/summary', async () => {
    const tasks = [...orquestrator.tasks.values()];

    let completedTasks = 0;
    let failedTasks = 0;
    let runningTasks = 0;
    let pendingTasks = 0;
    let queuedTasks = 0;
    let cancelledTasks = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const task of tasks) {
      switch (task.status) {
        case TASK_STATUS.COMPLETED: completedTasks++; break;
        case TASK_STATUS.FAILED: failedTasks++; break;
        case TASK_STATUS.RUNNING: runningTasks++; break;
        case TASK_STATUS.PENDING: pendingTasks++; break;
        case TASK_STATUS.QUEUED: queuedTasks++; break;
        case TASK_STATUS.CANCELLED: cancelledTasks++; break;
      }

      totalTokens += task.metrics.tokens.total ?? 0;
      totalCost += task.metrics.cost ?? 0;
    }

    return {
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      runningTasks,
      pendingTasks,
      queuedTasks,
      cancelledTasks,
      waitingTasks: 0,
      totalTokens,
      totalCost,
    };
  });

  // GET /api/report/graph — workflow dependency graph data
  fastify.get('/api/report/graph', async () => {
    const tasks = [...orquestrator.tasks.values()];

    const nodes = tasks.map((task) => ({
      id: task.options.taskId,
      label: task.options.title,
      status: task.status,
      agent: task.options.assignedTo,
      depth: task.options.depth,
    }));

    const edges: Array<{ source: string; target: string; type: string }> = [];

    for (const task of tasks) {
      // Parent-child edges
      if (task.options.parentId) {
        edges.push({
          source: task.options.parentId,
          target: task.options.taskId,
          type: 'subtask',
        });
      }

      // Subtask reference edges
      for (const subtaskId of task.subtaskIds) {
        edges.push({
          source: task.options.taskId,
          target: subtaskId,
          type: 'subtask',
        });
      }
    }

    return { nodes, edges };
  });
}
