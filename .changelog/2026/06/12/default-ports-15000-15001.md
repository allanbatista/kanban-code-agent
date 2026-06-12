# Default Ports 15000 15001

Date: 2026-06-12

## Changed

- Changed default daemon/API port to `15000`.
- Changed default web/Vite port to `15001`.

## Files

- `apps/daemon/src/server.js`: daemon default port.
- `apps/web/src/api.ts`: frontend daemon URL fallback.
- `scripts/dev-web.mjs`: local dev defaults.
- `playwright.config.js`: E2E web/daemon defaults.
- `tests/e2e/kanban.spec.js`: E2E daemon URL fallback.

## Validation

- `rtk rg -n "4174|4175|5183" .`
- `rtk pnpm lint`
