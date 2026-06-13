# Agent Logs e Comentarios

Date: 2026-06-13

## Changed

- Added task comments for user/agent interaction, automatic resume from human wait, and paginated task-scoped agent logs with terminal UI.
- Enriched agent logs with visible transcript events from the SDK, categories for messages/reasoning/tool activity, and expandable raw payloads in the terminal UI.
- Deduplicated repeated transcript stream events and normalized SDK `toolCall` message parts into concise tool-call log entries.
- Reformatted the logs tab as a Codex-style pretty terminal transcript with command/message rows instead of application-log columns.

## Files

- `packages/schemas/src/index.js`: added `task.comment`, `task.comments`, and `agent.logs` contracts.
- `packages/fsdb/src/index.js`: added paginated agent log reader.
- `packages/fsdb/src/chat-store.js`: added task comment aggregation.
- `packages/orchestrator/src/workflow-command-handlers.js`: added comment command and log/comment queries.
- `packages/orchestrator/src/task-agent-workflow-service.js`: writes execution feedback into comments.
- `apps/web/src/App.tsx`: loads task comments/logs and sends task comments.
- `apps/web/src/components/TaskModal.tsx`: replaced task assistant panel with comments and added logs tab.
- `apps/web/src/styles.css`: styled agent logs as a pretty terminal transcript.
- `packages/pi-adapter/src/index.js`: normalizes visible session transcript events into `agent.transcript`.
- `packages/agent-runtime/src/index.js`: persists SDK transcript events into task/session logs.
- `tests/e2e/kanban.spec.js`: validates comments, auto-resume, and logs UI.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk pnpm --filter @kca/web build`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-agent-logs pnpm test:e2e`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-agent-logs-pretty pnpm exec playwright test tests/e2e/kanban.spec.js -g "task comments answer"`
