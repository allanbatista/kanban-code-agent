# Spec First Gated Workflow

Date: 2026-06-14

## Changed

- Added spec-first workflow state, workflow commands, DoR/DoD gates, mediated completion, validation evidence, and UI workflow visibility.

## Files

- `packages/schemas/src/index.js`: added workflow task shape, commands, and events.
- `packages/fsdb/src/index.js`: initializes and backfills workflow state and official task artifacts.
- `packages/orchestrator/src/spec-workflow-service.js`: implements specs, handoffs, decisions, validation, DoR, and DoD.
- `packages/orchestrator/src/*`: routes completion, review, deployment, runnability, and move paths through workflow gates.
- `packages/pi-adapter/src/index.js`: exposes workflow tools to agents.
- `apps/web/src/*`: shows workflow state and routes completion through DoD review.
- `tests/unit/*.test.js`, `tests/e2e/kanban.spec.js`: cover gated workflow behavior.

## Validation

- `rtk proxy pnpm lint`
- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm test:e2e`
