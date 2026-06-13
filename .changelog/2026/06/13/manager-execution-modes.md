# Manager Execution Modes

Date: 2026-06-13

## Changed

- Added explicit manager modes for intake, contract review, execution planning, and progress control.
- Exposed `managerRouting.managerMode` in manager prompt context.
- Covered manager routing for concrete research, placeholder acceptance, and endpoint/API/schema work without adding `project_manager`.

## Files

- `packages/agent-runtime/src/index.js`: computes and renders manager mode.
- `packages/fsdb/src/index.js`: updates default manager prompt responsibilities.
- `tests/unit/orchestrator.test.js`: covers prompt modes and routing paths.
- `tests/unit/contracts-fixtures.test.js`: asserts no canonical `project_manager` role.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
