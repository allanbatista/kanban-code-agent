# Failed Task Reason Visible

Date: 2026-06-12

## Changed

- Failed and blocked tasks now expose the latest failure reason from task events in task detail and board state.
- The board card and task runtime tab now show the failure reason, including `prompt_not_sent`.

## Files

- `packages/fsdb/src/index.js`: derives `task.failure` from task events.
- `apps/web/src/components/Board.tsx`: renders failure reason on cards and adds a failed filter.
- `apps/web/src/components/TaskModal.tsx`: renders failure reason in runtime details.
- `apps/web/src/types.ts`: adds the task failure shape.
- `tests/unit/scheduler.test.js`: covers `failure.reason` after stale-run recovery.

## Validation

- `rtk node --check packages/fsdb/src/index.js`
- `rtk env KCA_PI_ADAPTER=fake node --test tests/unit/scheduler.test.js`
- `rtk pnpm lint`
- `rtk pnpm build`
- Browser validation: card and runtime tab show `prompt_not_sent` for `KCA-952327`.
