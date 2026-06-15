# Visible Inbox Task Save

Date: 2026-06-15

## Changed

- Made the new-task Save action publish an idle Inbox task instead of leaving it hidden as a draft.
- Kept hidden draft creation only for attachment autosave before the task is explicitly saved.

## Files

- `apps/web/src/App.tsx`: separates attachment draft autosave from visible task save.
- `apps/web/src/components/TaskModal.tsx`: accepts the draft save option contract.
- `tests/e2e/kanban.spec.js`: validates the card appears in Entrada and is not duplicated before execution.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm build`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15100 pnpm test:e2e`
