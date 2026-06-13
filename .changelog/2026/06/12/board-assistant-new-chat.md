# Board Assistant New Chat

Date: 2026-06-12

## Changed

- Added a board assistant header action to start a blank chat.
- Removed the assistant description, task metadata pills, and suggestion buttons from the assistant panel.
- Added a persisted board chat reset command that archives the previous board chat history.

## Files

- `apps/web/src/components/AssistantPanel.tsx`: compact header with new chat button and no suggestion block.
- `apps/web/src/App.tsx`: reset board chat command wiring and empty chat rendering.
- `apps/web/src/styles.css`: assistant panel layout update.
- `packages/fsdb/src/chat-store.js`: board chat reset/archive helper.
- `packages/orchestrator/src/workflow-command-handlers.js`: `chat.reset_board` command handler.
- `packages/schemas/src/index.js`: `chat.reset_board` command schema.
- `packages/core/src/contracts.js`: command contract list update.
- `tests/unit/orchestrator.test.js`, `tests/unit/contracts-fixtures.test.js`, `tests/e2e/kanban.spec.js`: coverage for reset and UI.

## Validation

- `rtk pnpm lint`
- `rtk env KCA_PI_ADAPTER=fake node --test tests/unit/orchestrator.test.js tests/unit/contracts-fixtures.test.js`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15111 KCA_E2E_DAEMON_PORT=15110 pnpm exec playwright test tests/e2e/kanban.spec.js`
