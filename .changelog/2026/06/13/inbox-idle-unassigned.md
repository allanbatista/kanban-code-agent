# Inbox Idle Unassigned

Date: 2026-06-13

## Changed

- Moving a task to `inbox` now makes it idle and clears active agent/role assignment.
- Historical routing fields remain preserved.

## Files

- `packages/task-service/src/index.js`: applies special `inbox` move semantics.
- `packages/schemas/src/index.js`: adds `task.unassigned` event type.
- `tests/unit/orchestrator.test.js`: covers `inbox` idle/unassigned behavior.

## Validation

- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm --filter @kca/web build`
