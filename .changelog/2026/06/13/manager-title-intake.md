# Manager Title Intake

Date: 2026-06-13

## Changed

- Tasks sent to manager without an explicit title now infer a title from an actionable user prompt.
- Abstract untitled manager tasks now move to `human_wait` with a manager comment requesting objective and action details.

## Files

- `packages/fsdb/src/index.js`: adds title-intent inference and human-wait routing.
- `packages/task-service/src/index.js`: lets FSDB apply creation-time title intake rules.
- `tests/unit/orchestrator.test.js`: covers actionable title inference and abstract human-wait routing.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
