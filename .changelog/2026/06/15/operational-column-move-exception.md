# Operational Column Move Exception

Date: 2026-06-15

## Changed

- Allowed direct task movement only between Entrada (`inbox`), Manager (`manager`), and Pronto (`done`).
- Kept movement to agent columns blocked.
- Made `Executar` from Entrada move the task to Manager before running.

## Files

- `packages/fsdb/src/index.js`: adds operational move rules and blocks agent-column moves.
- `packages/task-service/src/index.js`: supports service-level operational moves.
- `packages/orchestrator/src/task-agent-workflow-service.js`, `packages/orchestrator/src/workflow-command-handlers.js`: applies the same move contract in commands and updates.
- `apps/web/src/App.tsx`: moves Entrada tasks to Manager before execution.
- `apps/cli/src/kca.js`, `apps/daemon/src/server.js`, `packages/core/src/contracts.js`, `packages/application/src/handlers/command-handlers.js`: exposes `task.move` for the allowed operational columns.
- `tests/unit/*.test.js`, `tests/e2e/kanban.spec.js`: covers allowed and blocked movement.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
