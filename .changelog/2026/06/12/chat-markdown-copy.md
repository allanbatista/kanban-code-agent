# Chat Markdown Copy

Date: 2026-06-12

## Changed

- Rendered board and task chat messages as markdown with hover/focus copy buttons for the original markdown text.

## Files

- `apps/web/src/components/ChatMessageContent.tsx`: shared markdown renderer and copy action.
- `apps/web/src/components/AssistantPanel.tsx`: board chat uses markdown message content.
- `apps/web/src/components/TaskModal.tsx`: task chat uses markdown message content.
- `apps/web/src/styles.css`: markdown and copy-button styles.
- `apps/web/package.json`: added `marked`.
- `pnpm-lock.yaml`: recorded `marked` for the web app.

## Validation

- `pnpm -C apps/web typecheck`
- `pnpm -C apps/web build`
- Browser validation at `http://127.0.0.1:5173/`: markdown table rendered, copy button hidden off-message and visible on hover, copy action called `navigator.clipboard.writeText` with original markdown.
