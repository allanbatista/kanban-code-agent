# Agent Log Stream Comments

Date: 2026-06-13

## Changed

- Coalesced streamed agent transcript logs in the UI, added agent filters, auto-load of older logs on scroll, reduced stdout transcript noise, and limited task comments to the summary tab.

## Files

- `apps/web/src/components/TaskModal.tsx`: Controls task tabs, renders comments only in summary, and groups/coalesces agent logs.
- `apps/web/src/App.tsx`: Refreshes running task logs and caps the in-memory log buffer.
- `apps/web/src/styles.css`: Styles task comments, agent log tabs, and coalesced log entries.
- `packages/agent-runtime/src/index.js`: Logs transcript stream start/end to stdout instead of every streamed update.

## Validation

- `rtk proxy pnpm --filter @kca/web typecheck`
- `rtk proxy pnpm --filter @kca/web build`
- `rtk proxy pnpm test:unit`
- Browser validation at `http://127.0.0.1:15002/?task=KCA-686207`
