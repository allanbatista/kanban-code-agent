# Plan V2 F1 Domain Contracts

Date: 2026-06-12

## Changed

- Added canonical role registry for manager, product, design, engineering, quality, review and deployment.
- Added schemas for roles, planning, subtasks DAG v2, semaphore state and agent runs.
- Initialized FSDB defaults for roles, planning artifacts and runtime semaphores.
- Added fixtures and tests for the v2 domain contracts.

## Files

- `packages/core/src/roles.js`: role registry and lookup.
- `packages/core/src/contracts.js`: role IDs and planning/scheduler events.
- `packages/schemas/src/index.js`: v2 schemas for roles, planning, DAG and runtime state.
- `packages/fsdb/src/index.js`: settings roles, planning files, subtasks v2 and semaphores defaults.
- `packages/test-fixtures/src/index.js`: v2 role/planning/DAG fixtures.
- `tests/unit/*.test.js`: contract/schema/FSDB coverage for F1.
- `plan-v2.md`: marks F1 tasks done with evidence.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
