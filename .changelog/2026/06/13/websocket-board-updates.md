# WebSocket Board Updates

Date: 2026-06-13

## Changed

- Frontend now subscribes to daemon WebSocket events and refreshes board, orchestrator, chat, task files, settings, and provider queries from realtime events.
- Added WebSocket URL derivation for the daemon RPC endpoint.

## Files

- `apps/web/src/App.tsx`: replaces SSE subscription with WebSocket subscription, reconnect, and event-driven invalidation.
- `apps/web/src/api.ts`: adds `daemonWebSocketUrl()`.

## Validation

- `rtk proxy pnpm --filter @kca/web typecheck`
- `rtk proxy env KCA_WEB_PORT=15011 KCA_E2E_DAEMON_PORT=15010 KCA_E2E_STORAGE_ROOT=tmp/playwright-ws-fsdb pnpm exec playwright test tests/e2e/kanban.spec.js -g "refreshes the board when FSDB task files change externally"`
