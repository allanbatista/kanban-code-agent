# Orchestration Logs

Date: 2026-06-15

## Changed

- Added terminal logs for task duration, wait group assignment, received events, and formatted task messages.

## Files

- `index.ts`: logs task execution timing, event messages, completion messages, and subtask group/mode assignment.
- `README.md`: documents the richer terminal logs.

## Validation

- `rtk npm run typecheck`
