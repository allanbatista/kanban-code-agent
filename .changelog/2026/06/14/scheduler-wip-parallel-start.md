# Scheduler WIP Parallel Start

Date: 2026-06-14

## Changed

- Prevented queued tasks in the same WIP-limited column from blocking each other before any task starts.
- Changed scheduler launches to dispatch acquired runnable tasks in parallel instead of awaiting each agent run serially.
- Added regression coverage for queued WIP-column deadlock.

## Files

- `packages/orchestrator/src/runnability-service.js`: WIP checks now count running/validating/merge-pending work, not queued siblings.
- `packages/orchestrator/src/scheduler.js`: scheduler collects launch promises and waits after dispatching runnable tasks.
- `tests/unit/scheduler.test.js`: added regression test for queued tasks in the same WIP column.

## Validation

- `rtk pnpm exec node --test --test-name-pattern "queued tasks in same WIP column" tests/unit/scheduler.test.js`
- `rtk pnpm exec node --test tests/unit/scheduler.test.js`
- `rtk pnpm lint`
- Runtime validation: `KCA-884177-01`, `KCA-884177-02`, `KCA-884177-03`, `KCA-884177-04`, and parent `KCA-884177` reached `done`; runtime semaphores leases are empty.
