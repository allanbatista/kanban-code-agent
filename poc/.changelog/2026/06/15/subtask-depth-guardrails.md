# Subtask Depth Guardrails

Date: 2026-06-15

## Changed

- Added hierarchical subtask IDs using parent task ID plus `-{2_random}`.
- Added task metadata with depth, max depth, artifact paths, and subtask creation permission.
- Added prompt and runtime guardrails to prevent creating subtasks beyond depth 4.

## Files

- `index.ts`: derives subtask IDs from parents and injects task metadata into agent system prompt.

## Validation

- `rtk npm run typecheck`
