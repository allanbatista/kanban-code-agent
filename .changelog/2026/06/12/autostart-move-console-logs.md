# Autostart Move Console Logs

Date: 2026-06-12

## Changed

- Moving an idle task into an `autoStart` column now queues it for the scheduler.
- Daemon scheduler ticks now log started, blocked and skipped counts to the console.

## Files

- `packages/orchestrator/src/index.js`: auto-queue on move to autoStart columns.
- `apps/daemon/src/server.js`: scheduler console logs.
- `tests/unit/orchestrator.test.js`: autoStart move coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
