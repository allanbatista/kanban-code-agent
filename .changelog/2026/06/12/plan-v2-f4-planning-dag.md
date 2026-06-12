# Plan V2 F4 Planning DAG

Date: 2026-06-12

## Changed

- Added DAG validation for duplicate provides, missing contracts and cycles.
- Validated task decomposition for N subtasks and persisted `subtasks@2` edges.
- Added planning artifact helper for roles and acceptance.
- Added scheduler coverage for dependent subtasks.
- Displayed real child subtasks in the task modal.

## Files

- `packages/core/src/dag.js`: DAG validator.
- `packages/orchestrator/src/planning-service.js`: planning artifact helper.
- `packages/orchestrator/src/index.js`: validates decompose DAG before persisting.
- `apps/web/src/App.tsx`: passes task list into modal.
- `apps/web/src/components/TaskModal.tsx`: displays subtasks.
- `tests/unit/dag.test.js`: graph validation coverage.
- `tests/unit/orchestrator.test.js`: planning and N-subtask coverage.
- `tests/unit/scheduler.test.js`: dependency scheduling coverage.
- `tests/e2e/kanban.spec.js`: modal subtasks coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
