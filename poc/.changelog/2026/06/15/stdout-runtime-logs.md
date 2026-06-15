# Stdout Runtime Logs

Date: 2026-06-15

## Changed

- Added readable stdout lines for swarm events and orchestrator logs as they occur, without model delta streaming.
- Documented real-time stdout logging and current `.swarm` paths.

## Files

- `index.ts`: formats and prints complete event/log lines at write time.
- `README.md`: documents stdout logging and persisted log/event paths.

## Validation

- `rtk npm run typecheck`
