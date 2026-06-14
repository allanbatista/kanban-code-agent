# Task Relation Card Links

Date: 2026-06-14

## Changed

- Compact task relation IDs on cards into one unlabeled row and open the referenced task modal when clicked.

## Files

- `apps/web/src/components/Board.tsx`: renders unique relation IDs and routes clicks to the referenced task.
- `apps/web/src/styles.css`: styles compact relation ID pills.
- `tests/e2e/kanban.spec.js`: validates relation ID display and modal navigation.

## Validation

- `rtk proxy pnpm --filter @kca/web typecheck`
- `rtk env KCA_PI_ADAPTER=fake KCA_WEB_PORT=15141 KCA_E2E_DAEMON_PORT=15140 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-relation-click-2 pnpm exec playwright test tests/e2e/kanban.spec.js --grep "subtask relation id opens"`
