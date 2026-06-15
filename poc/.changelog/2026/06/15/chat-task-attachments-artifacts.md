# Chat Task Attachments Artifacts

Date: 2026-06-15

## Changed

- Removed task descriptions in favor of chat-only task input.
- Added CLI attachments copied into task folders and referenced by chat messages.
- Changed agent decisions to return message lists.
- Added task artifact creation and `artifacts.yaml` indexing.

## Files

- `index.ts`: chat-only task contract, attachments, artifacts, message-list results.
- `README.md`: CLI, architecture, rules, and definitions.
- `.features/20260615-1551-chat-task-attachments/plan.md`: feature workflow and evidence tracking.

## Validation

- `rtk npm run typecheck`
