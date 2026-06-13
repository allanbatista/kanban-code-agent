# Task Creation Chat Defaults

Date: 2026-06-12

## Changed

- Simplified assistant task creation so priority and task type are not requested, default column is entrada/inbox, and recent chat context can supply the task payload.
- Updated assistant tools and UI save payloads to stop exposing priority/type as user-facing task creation fields.

## Files

- `packages/orchestrator/src/agent-chat-workflow-service.js`: infer task title/description from prompt or recent chat and clarify subjective requests.
- `packages/pi-adapter/src/index.js`: remove priority/type from assistant tool contracts and task detail text.
- `packages/schemas/src/index.js`: remove explicit task kind from the create command contract.
- `apps/web/src/App.tsx`: stop sending priority/type from task save.
- `apps/web/src/components/TaskModal.tsx`: stop providing priority/type from modal submit.
- `tests/unit/orchestrator.test.js`: cover contextual task creation and entrada/inbox default.
- `tests/unit/pi-adapter.test.js`: update tool contract expectation.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 pnpm exec playwright test tests/e2e/kanban.spec.js`
