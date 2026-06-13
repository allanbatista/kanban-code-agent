# Legacy Definition Column

Date: 2026-06-12

## Changed

- Preserve legacy board column IDs when creating or moving tasks, so moving to an existing `definition` column keeps the task visible instead of normalizing it to `product`.

## Files

- `packages/fsdb/src/index.js`: resolves stored column IDs against the current board before applying aliases.
- `tests/unit/orchestrator.test.js`: adds regression coverage for moving to a legacy `definition` column.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
