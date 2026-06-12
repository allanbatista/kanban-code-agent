# Plan V2 F6 Multiagent UI

Date: 2026-06-12

## Changed

- Added real task file query/write support for acceptance editing.
- Updated task modal to read/write acceptance, events, files and real subtasks.
- Added board card role/parallel metadata.
- Added semaphore lease visibility to orchestrator status and panel.
- Added E2E coverage for acceptance editing, task chat history and semaphores panel.

## Files

- `packages/core/src/contracts.js`: task file command/query contracts.
- `packages/schemas/src/index.js`: task file command/query schemas.
- `packages/orchestrator/src/index.js`: `task.files`, `task.file.write`, semaphore status.
- `apps/web/src/types.ts`: task file and semaphore types.
- `apps/web/src/App.tsx`: task files query and save wiring.
- `apps/web/src/components/Board.tsx`: role/parallel card metadata.
- `apps/web/src/components/TaskModal.tsx`: real acceptance/events/files tabs.
- `apps/web/src/components/OrchestratorPanel.tsx`: semaphore/lease UI.
- `tests/e2e/kanban.spec.js`: F6 UI coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
