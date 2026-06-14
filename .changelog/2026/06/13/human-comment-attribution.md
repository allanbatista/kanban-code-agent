# Human Comment Attribution

Date: 2026-06-13

## Changed

- Display human task replies as human while preserving agent return-role routing context.

## Files

- `packages/fsdb/src/chat-store.js`: Stores optional display persona on chat messages.
- `packages/orchestrator/src/workflow-command-handlers.js`: Marks task comments from users with human display identity.
- `apps/web/src/App.tsx`: Maps display persona from daemon chat payloads.
- `apps/web/src/components/TaskModal.tsx`: Renders human display identity for user replies.
- `apps/web/src/types.ts`: Adds display persona to chat message type.
- `tests/unit/orchestrator.test.js`: Covers preserved return persona and human display identity.
- `tests/e2e/kanban.spec.js`: Verifies the chat label shown after replying.

## Validation

- `rtk node --test --test-name-pattern='task comments answer agent input' tests/unit/orchestrator.test.js`
- `rtk env KCA_WEB_PORT=15141 KCA_E2E_DAEMON_PORT=15140 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15140 pnpm exec playwright test tests/e2e/kanban.spec.js --grep "task comments answer agent questions"`
- `rtk pnpm lint`
- `rtk pnpm test:unit`
