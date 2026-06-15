# Interrupt Before Move

Date: 2026-06-15

## Changed

- Interrompe running tasks before moving them to another column.
- Reuses the same move path for the board assistant and the explicit `task.move` command.

## Files

- `packages/orchestrator/src/task-agent-workflow-service.js`: added interrupt-aware move helper.
- `packages/orchestrator/src/workflow-command-handlers.js`: routes `task.move` through the helper.
- `packages/orchestrator/src/agent-chat-workflow-service.js`: board assistant move uses the same helper.
- `tests/unit/orchestrator.test.js`: asserts interruption happens before the move event.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15100 pnpm test:e2e`
