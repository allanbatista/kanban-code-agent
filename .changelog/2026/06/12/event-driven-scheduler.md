# Event Driven Scheduler

Date: 2026-06-12

## Changed

- Removed periodic daemon scheduler polling in favor of startup recovery plus event-driven queue drains.
- Triggered scheduler drains after persona moves, completions, unblocks, handoffs, reviews, deployments, merges, decompositions, and settings changes.
- Released semaphore leases when tasks leave active execution and aligned lease capacity with runtime settings.

## Files

- `apps/daemon/src/server.js`: scheduler startup recovery and scheduler result broadcasts.
- `packages/orchestrator/src/index.js`: event-driven scheduler drain hooks and lease release points.
- `packages/orchestrator/src/scheduler.js`: scheduler semaphore requests carry configured capacities.
- `packages/fsdb/src/runtime-store.js`: semaphore acquisition honors request capacity.
- `tests/unit/orchestrator.test.js`: event-driven scheduler expectations.
- `tests/e2e/kanban.spec.js`: daemon event-driven scheduler coverage.

## Validation

- `rtk node --check apps/daemon/src/server.js`
- `rtk node --check packages/orchestrator/src/index.js`
- `rtk node --check packages/orchestrator/src/scheduler.js`
- `rtk node --check packages/fsdb/src/runtime-store.js`
- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
