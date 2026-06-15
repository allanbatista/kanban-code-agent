# No Agent Move Workflow

Date: 2026-06-15

## Changed

- Removed task movement between agent columns from public workflows and UI controls, except the operational `inbox`/`manager`/`done` path.
- Replaced the human wait column with `waiting_human` status in the current column.
- Converted persona handoffs into delegated subtasks and added versioned subtask result files.

## Files

- `packages/fsdb/src/index.js`: removes new `human_wait` board state, migrates legacy tasks, blocks agent-column move mutations, hides done subtasks.
- `packages/orchestrator/src/*`: preserves task column/routing for agent handoffs, delegates persona work to subtasks, versions subtask results, and blocks agent move/route commands.
- `packages/pi-adapter/src/index.js`: removes the move tool and updates task-agent tool descriptions.
- `apps/web/src/App.tsx`, `apps/web/src/components/Board.tsx`, `apps/web/src/components/TaskModal.tsx`: remove agent move UI, keep execute routed through Manager, hide done subtasks.
- `tests/unit/*.test.js`, `tests/e2e/kanban.spec.js`: update coverage for the new workflow contract.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
