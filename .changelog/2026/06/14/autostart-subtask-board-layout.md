# AutoStart Subtask Board Layout

Date: 2026-06-14

## Changed

- Preserved human-wait terminal runs, auto-queued eligible idle auto-start tasks, enriched subtask execution context, and updated board layout/create controls.

## Files

- `packages/orchestrator/src/scheduler.js`: normalizes eligible idle auto-start tasks to queued and reports `autoQueued`.
- `apps/daemon/src/server.js`: runs scheduler tick on startup even without pre-existing queued tasks.
- `apps/web/src/components/Board.tsx`: renders primary columns first, stacks agent pairs, and limits create buttons.
- `apps/web/src/App.tsx`: removes topbar `Nova task`.
- `apps/web/src/styles.css`: styles stacked agent columns.
- `tests/unit/scheduler.test.js`: covers AutoStart eligibility and exclusions.
- `tests/e2e/kanban.spec.js`: validates board layout, create controls, subtask context, and scheduler flows.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm build`
- `rtk pnpm lint`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15100 pnpm test:e2e`
