# Provider Settings Refresh

Date: 2026-06-14

## Changed

- Settings save now waits for state/provider cache refresh so provider selections reopen with persisted values.
- E2E coverage now verifies provider model and effort survive save/reopen.

## Files

- `apps/web/src/App.tsx`: refreshes settings-related queries after app settings save.
- `tests/e2e/kanban.spec.js`: covers provider defaults persistence.

## Validation

- `rtk proxy pnpm --filter @kca/web typecheck`
- `rtk proxy env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-provider-save pnpm exec playwright test tests/e2e/kanban.spec.js -g "settings modal persists scoped settings through the daemon"`
