# Direct Column Task Autostart

Date: 2026-06-13

## Changed

- Creating a task directly in an auto-start column now queues it with that column's role/agent and drains the scheduler.
- Scheduler drain after `task.create` is limited to auto-start columns so manually queued internal setup remains controllable.

## Files

- `packages/task-service/src/index.js`: applies auto-start column routing during task creation.
- `packages/orchestrator/src/workflow-command-handlers.js`: drains scheduler for direct auto-start creates only.
- `tests/unit/orchestrator.test.js`: covers direct create in `product`.
- `tests/unit/scheduler.test.js`: keeps manual scheduler tests independent from auto-start creates.
- `tests/e2e/kanban.spec.js`: covers UI creation directly in Produto and verifies the workflow reaches `running`.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15100 pnpm test:e2e`
- `rtk pnpm build`
- `rtk pnpm test:pi`
