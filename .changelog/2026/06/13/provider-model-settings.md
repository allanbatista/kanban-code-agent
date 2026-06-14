# Provider Model Settings

Date: 2026-06-13

## Changed

- Added global AI provider/model settings, enabled provider toggles, model discovery, and per-agent inheritance/override controls.
- Added OpenAI-compatible provider registry, `/models` normalization, runtime provider resolution, and chat-completions tool-call adapter.
- Restricted global provider choices to enabled providers and added default model/effort controls globally and per enabled provider.
- Automatically loads `/models` for every provider/model selector shown in Settings.
- Replaced native datalist model inputs with a visible custom autocomplete combobox.

## Files

- `packages/core/src/providers.js`: provider registry, discovery, model listing, and resolver.
- `packages/agent-runtime/src/index.js`: provider/model resolution and adapter selection.
- `packages/pi-adapter/src/index.js`: OpenAI-compatible tool-call adapter.
- `apps/web/src/components/SettingsDialog.tsx`: global providers UI and agent provider/model comboboxes.
- `apps/web/src/types.ts`: AI settings default effort and provider default types.
- `tests/unit/orchestrator.test.js`, `tests/unit/pi-adapter.test.js`, `tests/e2e/kanban.spec.js`: provider/model/runtime/UI coverage.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm --filter @kca/web build`
- `rtk pnpm test:e2e`
- `rtk pnpm lint`
- `rtk pnpm exec playwright test tests/e2e/kanban.spec.js -g "settings modal"`
