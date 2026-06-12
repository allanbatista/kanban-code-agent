# Plan V2 F3 Chat Runtime

Date: 2026-06-12

## Changed

- Added persistent board/task chat history in FSDB.
- Added `chat.history` query and UI reload of persisted chat messages.
- Recorded agent run role, scope, allowed tools and prompt hash in session JSONL.
- Added unit and E2E coverage for chat history and run metadata.

## Files

- `packages/fsdb/src/chat-store.js`: chat JSONL storage.
- `packages/orchestrator/src/index.js`: persisted `agent.chat` messages and `chat.history`.
- `packages/agent-runtime/src/index.js`: run metadata.
- `apps/web/src/App.tsx`: loads persisted board/task chat histories.
- `apps/web/src/components/TaskModal.tsx`: renders persisted task chat.
- `tests/unit/orchestrator.test.js`: chat/run metadata coverage.
- `tests/e2e/kanban.spec.js`: reload persistence coverage.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
