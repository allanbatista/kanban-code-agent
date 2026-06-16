# Task Artifacts

Date: 2026-06-15

## Changed

- Added per-task artifact directories with `task.yml` and `session.jsonl`.
- Changed task IDs to `t-{nanosecond-timestamp-base36}{2-random-chars}`.

## Files

- `index.ts`: creates and persists task artifact directories for tasks and subtasks.

## Validation

- `rtk npm run typecheck`
