# Dev Web Bootstrap

Date: 2026-06-12

## Changed

- Made `pnpm dev:web` initialize FSDB, start the daemon, wait for health, and start Vite with the correct daemon URL.
- Added `dev:frontend` for running only the frontend when needed.

## Files

- `package.json`: updates dev scripts and lint coverage.
- `scripts/dev-web.mjs`: boots storage, daemon and web together.

## Validation

- `rtk pnpm lint`
- `rtk timeout 10s env KCA_DAEMON_PORT=4219 pnpm dev:web -- --port 5319`
- Confirmed `~/.kanban-code-agent/settings/boards/default.yaml` and `~/.kanban-code-agent/settings/agents/assistant.yaml` exist.
