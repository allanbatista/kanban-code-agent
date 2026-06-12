# Plan V2 F2 Scheduler Foundation

Date: 2026-06-12

## Changed

- Added task state transitions, runtime semaphore leases, and `scheduler.tick`.
- Recorded remaining daemon loop work as pending.

## Files

- `packages/orchestrator/src/state-machine.js`: pure task transition helper.
- `packages/orchestrator/src/scheduler.js`: runnable task selection and semaphore-aware scheduler tick.
- `packages/fsdb/src/runtime-store.js`: persisted runtime semaphore lease store.
- `packages/orchestrator/src/index.js`: command integration for `scheduler.tick`.
- `packages/core/src/contracts.js`: scheduler command contract.
- `packages/schemas/src/index.js`: scheduler command schema.
- `tests/unit/scheduler.test.js`: state machine, semaphore and scheduler coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
