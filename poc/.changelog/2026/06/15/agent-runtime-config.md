# Agent Runtime Config

Date: 2026-06-15

## Changed

- Added per-agent and per-task model alias/effort runtime config, task chat persistence, and same-task retry decisions.
- Required every `Agent` constructor call to pass a complete default runtime config.
- Reduced model aliases to `fast`, `balanced`, and `deep`.
- Moved per-task chat persistence from swarm state/task YAML into `tasks/{taskId}/chat.jsonl`.

## Files

- `index.ts`: Adds safe model aliases, effort validation, CLI/tool overrides, retry handling, and persisted task chat/runtime metadata.
- `tasks/{taskId}/chat.jsonl`: Stores task chat as one JSON message per line.

## Validation

- `rtk npm run typecheck`
- `rtk npm start -- --model=fast --effort=off "responda somente oi"`
- Inspected `.swarm-state.json`, `tasks/t-dj9tuvj5mqc9rw/task.yml`, and `tasks/t-dj9tuvj5mqc9rw/chat.jsonl` for runtime config and JSONL chat persistence.
