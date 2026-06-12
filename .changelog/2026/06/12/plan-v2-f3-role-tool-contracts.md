# Plan V2 F3 Role Tool Contracts

Date: 2026-06-12

## Changed

- Exported Pi adapter kanban tool contracts for mockable context execution.
- Added role `scope` and `promptPath` defaults and schema validation.
- Added task assistant support for acceptance updates by scope.
- Added unit coverage for acceptance updates, task decomposition, role defaults, and Pi tool effects.

## Files

- `packages/pi-adapter/src/index.js`: exported tool contract builder.
- `packages/core/src/roles.js`: role scope and prompt defaults.
- `packages/schemas/src/index.js`: role schema fields.
- `packages/orchestrator/src/index.js`: task assistant acceptance update action.
- `tests/unit/pi-adapter.test.js`: mock tool effect coverage.
- `tests/unit/orchestrator.test.js`: scoped task assistant coverage.
- `tests/unit/schemas.test.js`: role defaults coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
