# Wait Groups

Date: 2026-06-15

## Changed

- Added run-scoped wait groups for mixed `WAIT_ALL` and `ON_DEMAND` subtask orchestration.

## Files

- `index.ts`: replaces flat wait state with runs/wait groups and updates scheduler readiness.
- `README.md`: documents the new `waiting.waitGroups[]` contract.
- `.features/20260615-1649-wait-groups/plan.md`: records plan, DoD, and validation evidence.

## Validation

- `rtk npm run typecheck`
