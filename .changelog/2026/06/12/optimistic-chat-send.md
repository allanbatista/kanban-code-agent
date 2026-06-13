# Optimistic Chat Send

Date: 2026-06-12

## Changed

- Show user chat messages immediately while the daemon request is pending.
- Show a spinner placeholder saying `Pensando...` until the assistant response arrives.
- Disable chat inputs/actions while waiting for the response.

## Files

- `apps/web/src/components/AssistantPanel.tsx`: optimistic board chat state and send locking.
- `apps/web/src/components/TaskModal.tsx`: optimistic task chat state and send locking.
- `apps/web/src/styles.css`: spinner and thinking placeholder styles.

## Validation

- `rtk pnpm lint`
- `rtk pnpm build`
- Browser validation with delayed `/api/command` response confirmed immediate user message, `Pensando...`, disabled send, and final reply.
