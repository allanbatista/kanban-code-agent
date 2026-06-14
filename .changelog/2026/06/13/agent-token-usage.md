# Agent Token Usage

Date: 2026-06-13

## Changed

- Added real provider token usage capture, aggregation, and UI display per task/agent.
- Included real Pi/DeepSeek transcript usage already stored in task events.
- Added consumed time per agent and task total based on run event timestamps.
- Replaced card token chips with a compact created-at/total-time row and kept detailed token metrics in the modal.
- Fixed task card inner alignment so short content does not shrink or center within the card.
- Leaves unavailable card timing values blank instead of showing `n/d`.

## Files

- `packages/pi-adapter/src/index.js`: normalizes real provider usage events.
- `packages/fsdb/src/index.js`: aggregates usage into board snapshots.
- `apps/web/src/components/Board.tsx`: shows created-at and total time on cards without token chips.
- `apps/web/src/components/TaskModal.tsx`: shows per-agent usage in task execution view.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-usage pnpm test:e2e`
