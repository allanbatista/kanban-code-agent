# Stdout Logs All Stages

Date: 2026-06-12

## Changed

- Added structured stdout logs across daemon, CLI, fsdb, orchestrator, scheduler, agent runtime, Pi adapter, and supporting services.
- Added workspace dependencies so the new shared logger resolves at runtime.

## Files

- `packages/core/src/log.js`: shared stdout log helper.
- `apps/daemon/src/server.js`: request, scheduler, websocket, SSE, and bootstrap logs.
- `apps/cli/src/kca.js`: command start/end/error logs.
- `packages/fsdb/src/*.js`: storage, task, settings, chat, and semaphore logs.
- `packages/orchestrator/src/*.js`: command/query lifecycle and service logs.
- `packages/agent-runtime/src/index.js`: run/chat lifecycle logs.
- `packages/pi-adapter/src/index.js`: SDK/session/doctor logs.

## Validation

- `rtk node --check` on all modified JS files.
- `rtk pnpm test:unit`
- `rtk curl -s http://127.0.0.1:15056/health`
