# Final Workflow P1 P2

Date: 2026-06-14

## Changed

- Added formal P1 workflow artifacts, stricter DoR/DoD evidence checks, workflow policy settings, and operational workflow inspection panels.
- Recorded remaining P2 production hardening as explicit pending work.

## Files

- `packages/schemas/src/index.js`: added P1 workflow commands, events, artifacts, and workflow policy settings.
- `packages/orchestrator/src/spec-workflow-service.js`: writes P1 artifacts and enforces required planning, delivery, summary, decision, and handoff evidence.
- `packages/orchestrator/src/workflow-command-handlers.js`: registers P1 workflow commands.
- `packages/fsdb/src/index.js`: adds workflow policy defaults and P1 artifact metadata.
- `packages/pi-adapter/src/index.js`, `packages/core/src/roles.js`: expose P1 artifact tools to agents.
- `apps/web/src/components/SettingsDialog.tsx`, `apps/web/src/components/TaskModal.tsx`, `apps/web/src/types.ts`: expose workflow policies and operational inspection panels.
- `tests/unit/*.test.js`, `tests/e2e/kanban.spec.js`: cover P1 gates, settings, tools, and browser UI.

## Validation

- `rtk proxy pnpm lint`
- `rtk proxy pnpm test:unit`
- `rtk proxy pnpm test:e2e`
