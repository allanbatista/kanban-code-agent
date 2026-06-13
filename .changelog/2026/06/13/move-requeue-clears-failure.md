# Move Requeue Clears Failure

Date: 2026-06-13

## Changed

- Re-queue events now clear stale failure badges derived from earlier failure events.
- Moving a task to its current column is now a no-op without persistence or scheduler drain.
- The board UI now skips the backend command entirely when a card is dropped on its current column.

## Files

- `packages/fsdb/src/index.js`: clears derived failures after recovery events.
- `packages/task-service/src/index.js`: skips same-column moves.
- `packages/orchestrator/src/workflow-command-handlers.js`: skips scheduler drain for move no-ops.
- `apps/web/src/App.tsx`: skips move commands when the target column is unchanged.
- `apps/web/src/components/Board.tsx`: avoids calling move handlers for same-column drops.
- `tests/unit/orchestrator.test.js`: covers stale failure clearing and same-column no-op.

## Validation

- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm --filter @kca/web build`
