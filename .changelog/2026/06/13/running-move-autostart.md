# Running Move Autostart

Date: 2026-06-13

## Changed

- Moving a running task into an auto-start column now queues it for the target column agent after invalidating the current run.
- Added coverage for running task moves into `manager`.

## Files

- `packages/task-service/src/index.js`: queues and reroutes running/interrupted moves into auto-start columns.
- `tests/unit/orchestrator.test.js`: covers running task move to manager.
- `AGENTS.md`: records optimistic frontend interaction rule.

## Validation

- `rtk proxy pnpm test:unit`
