# Subtask Based Delegation

Date: 2026-06-14

## Changed

- Delegation now creates child subtasks, keeps parents in place, records parent/main metadata, requeues waiting parents on child completion, and exposes direct subtask progress in board/modal UI.

## Files

- `packages/orchestrator/src/persona-workflow-service.js`: creates delegated child tasks.
- `packages/orchestrator/src/task-decomposition-service.js`: writes parent/main metadata and waits parent tasks.
- `packages/orchestrator/src/task-agent-workflow-service.js`: reports child results and requeues waiting parents.
- `packages/fsdb/src/index.js`: projects direct child counters.
- `apps/web/src/components/Board.tsx`: displays parent/main badges and direct counters.
- `apps/web/src/components/TaskModal.tsx`: shows subtask parent/main details.
- `tests/unit/orchestrator.test.js`: covers delegation, self-contained child context, and parent requeue.
- `tests/e2e/kanban.spec.js`: covers modal and delegation workflow behavior.

## Validation

- `rtk env KCA_PI_ADAPTER=fake pnpm test:unit`
- `rtk proxy pnpm lint`
- `rtk env KCA_PI_ADAPTER=fake KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-subtasks pnpm exec playwright test tests/e2e/kanban.spec.js --grep "task modal exposes tabs|agentic task workflow"`
- 5-scenario validation harness: all requested task workflows completed below timeout; combined task spawned and completed 4 child subtasks.
