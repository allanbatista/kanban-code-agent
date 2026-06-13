# New Task Draft UX

Date: 2026-06-13

## Changed

- Added hidden persisted draft tasks with optional title fallback.
- Simplified new-task UI with Markdown highlighting, uploads, paste-image upload, save draft, and save-and-execute.
- Added persisted task attachment command and attachment listing.

## Files

- `apps/web/src/App.tsx`: handles draft save, execute, and attachment upload.
- `apps/web/src/components/TaskModal.tsx`: adds focused draft creation UI.
- `packages/schemas/src/index.js`: adds draft status and attachment command contract.
- `packages/fsdb/src/index.js`: persists draft titles, filters board drafts, and writes attachments.
- `packages/task-service/src/index.js`: queues draft publication and records attachment events.
- `tests/e2e/kanban.spec.js`: validates draft, paste upload, and execute flow.
- `tests/unit/orchestrator.test.js`: validates draft visibility and attachment persistence.

## Validation

- `rtk proxy pnpm lint`
- `rtk proxy pnpm test:unit`
- `rtk proxy env KCA_WEB_PORT=15011 KCA_E2E_DAEMON_PORT=15010 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-draft pnpm test:e2e`
