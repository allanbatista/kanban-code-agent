# Plan V2 F2 Daemon Scheduler Loop

Date: 2026-06-12

## Changed

- Added autonomous daemon scheduler loop for queued runnable tasks.
- Serialized daemon bootstrap to avoid concurrent FSDB initialization races.
- Made FSDB atomic temp files unique per write.
- Added E2E coverage proving queued task auto-starts through the daemon.

## Files

- `apps/daemon/src/server.js`: scheduler loop, startup guard, health scheduler metadata.
- `packages/fsdb/src/index.js`: safer atomic temp file names.
- `packages/fsdb/src/runtime-store.js`: safer runtime atomic temp file names.
- `tests/e2e/kanban.spec.js`: scheduler auto-start E2E.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
