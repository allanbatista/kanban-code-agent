# Event Driven Orchestrator Reconciler

Date: 2026-06-15

## Changed

- Replaced public `scheduler.tick` command flow with in-process event-driven orchestrator reconciliation.
- Added `orchestrator.reconciled` runtime/socket event and reconciler queue for command and FSDB events.
- Updated unit and e2e coverage for automatic starts after create/move and `spawn_subtasks`.

## Files

- `packages/orchestrator/src/reconciler.js`: event-driven reconciliation, capacity checks, semaphore leases, recovery.
- `apps/daemon/src/server.js`: daemon event wiring and reconciler queue broadcasting.
- `packages/schemas/src/index.js`: removes `scheduler.tick` command and adds `orchestrator.reconciled` event.
- `tests/unit/orchestrator.test.js`: adds tool-event subtask start regression.
- `tests/e2e/kanban.spec.js`: validates daemon reconciler behavior.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15100 pnpm test:e2e`
- `rtk pnpm build`
