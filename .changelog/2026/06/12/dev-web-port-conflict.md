# Dev Web Port Conflict

Date: 2026-06-12

## Changed

- Made `pnpm dev:web` reuse an existing healthy daemon on port 15000 or choose the next available daemon port.
- Delayed daemon WebSocket, poller, and scheduler startup until after the HTTP server successfully binds.

## Files

- `scripts/dev-web.mjs`: checks daemon health and available ports before spawning processes.
- `apps/daemon/src/server.js`: handles listen errors and starts runtime services only after binding.

## Validation

- `node --check scripts/dev-web.mjs`
- `node --check apps/daemon/src/server.js`
- `curl -sS http://127.0.0.1:15000/health`
- `timeout 12s pnpm dev:web` reused daemon `15000` and started Vite on `15003` with `15001/15002` occupied.
- `pnpm lint`
