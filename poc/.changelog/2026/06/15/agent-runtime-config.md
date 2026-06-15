# Agent Runtime Config

Date: 2026-06-15

## Changed

- Added per-agent and per-task model alias/effort runtime config, task chat persistence, and same-task retry decisions.
- Required every `Agent` constructor call to pass a complete default runtime config.
- Reduced model aliases to `fast`, `balanced`, and `deep`.

## Files

- `index.ts`: Adds safe model aliases, effort validation, CLI/tool overrides, retry handling, and persisted task chat/runtime metadata.

## Validation

- `rtk npm run typecheck`
- `rtk npm start -- --model=fast --effort=off "responda somente oi"`
- Inspected `.swarm-state.json` and `tasks/t-dj9s9nzu2d40mb/task.yml` for runtime config and chat persistence.
