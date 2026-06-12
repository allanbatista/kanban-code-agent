# Agentic Task Workflow

Date: 2026-06-12

## Changed

- Implemented responsibility-based board routing, persona handoffs, human wait, provider discovery/settings, persona chat build, manual/automatic chat compaction, review/deployment gates, and agentic workflow validation.

## Files

- `packages/core/src/roles.js`: added `generalist` and role model defaults.
- `packages/core/src/providers.js`: added provider env discovery without secrets.
- `packages/fsdb/src/index.js`: added responsibility columns and legacy column aliases.
- `packages/fsdb/src/chat-store.js`: added task/persona active chats and compaction history.
- `packages/orchestrator/src/index.js`: added agentic workflow commands and queries.
- `packages/agent-runtime/src/index.js`: added deterministic agent chat build.
- `apps/web/src/components/SettingsDialog.tsx`: added provider/model/effort controls with env status.
- `tests/unit/orchestrator.test.js`: covered handoff, human wait, delegation, provider discovery, chat build, and compaction.
- `tests/e2e/kanban.spec.js`: covered browser flows, provider settings, and agentic workflow persistence through review/deployment.

## Validation

- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-agentic pnpm test:e2e`
