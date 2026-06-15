# Inbox Card Execute Action

Date: 2026-06-15

## Changed

- Added an `Executar` action on task cards in the Entrada column.
- Removed workflow metadata chips (`depth`, `phase`, `role`, `gate`) from task and subtask cards.

## Files

- `apps/web/src/components/Board.tsx`: adds the inbox card run action and removes workflow metadata chips.
- `apps/web/src/App.tsx`: wires card execution to move Entrada tasks to Manager before `task.run`.
- `apps/web/src/styles.css`: styles the visible execute button.
- `tests/e2e/kanban.spec.js`: validates the button, execution behavior, and removed chips.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
