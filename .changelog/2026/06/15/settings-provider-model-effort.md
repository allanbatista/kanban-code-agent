# Settings Provider Model Effort

Date: 2026-06-15

## Changed

- Converted settings provider/model/effort controls to autocomplete comboboxes.
- Added `none` and `xhigh` effort support while preserving legacy `minimal`.
- Restored provider settings reliably after modal reopen and page reload.
- Preserved provider model effort capability metadata.

## Files

- `apps/web/src/components/SettingsDialog.tsx`: combobox controls, effort filtering, draft hydration.
- `apps/web/src/types.ts`: effort and provider model capability types.
- `packages/core/src/providers.js`: supported effort normalization.
- `packages/schemas/src/index.js`: shared effort schema values.
- `tests/e2e/kanban.spec.js`: settings modal combobox and reload coverage.
- `tests/unit/providers.test.js`: provider model capability coverage.
- `tests/unit/schemas.test.js`: effort schema coverage.

## Validation

- `rtk pnpm lint`
- `rtk node --test tests/unit/schemas.test.js`
- `rtk node --test tests/unit/providers.test.js`
- `rtk node --input-type=module -e "...normalizeModel..."`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-settings pnpm exec playwright test tests/e2e/kanban.spec.js --grep "settings modal"`
- `rtk node --test tests/unit/orchestrator.test.js --test-name-pattern "provider"`: provider tests passed; command also ran wider file and 5 unrelated assistant-chat tests failed.
