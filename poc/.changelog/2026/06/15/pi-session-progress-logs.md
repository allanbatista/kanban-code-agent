# Pi Session Progress Logs

Date: 2026-06-15

## Changed

- Added Pi session heartbeat, streaming deltas, tool call/result logs, and lowered Manager effort to reduce orchestration latency.

## Files

- `index.ts`: logs provider progress while the model is still running and uses `minimal` effort for the Manager.

## Validation

- `rtk npm run typecheck`
