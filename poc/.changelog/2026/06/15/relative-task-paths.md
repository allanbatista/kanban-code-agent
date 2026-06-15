# Relative Task Paths

Date: 2026-06-15

## Changed

- Persist task-related file references relative to the task directory and stop exposing `task_dir`.
- Remove duplicated task file references from `memory`.

## Files

- `index.ts`: stores task file references relative to the task directory and removes `taskDir` metadata.
- `README.md`: documents task-relative path persistence and runtime task directory inference.

## Validation

- `rtk npm run typecheck`
