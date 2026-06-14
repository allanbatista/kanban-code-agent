# Agent Max Parallel Tasks

Date: 2026-06-14

## Changed

- Added global and per-agent max parallel task configuration with legacy `agentTokens`/`tokens` fallback.
- Migrated existing default agents without `limits.maxParallelTasks` to the new default of 50.
- Exposed runtime and agent concurrency controls in settings.
- Added visible task count badges to board column headers.

## Files

- `packages/fsdb/src/index.js`: default limits and agent normalization.
- `packages/orchestrator/src/agent-capacity.js`: per-agent capacity fallback helper.
- `packages/orchestrator/src/scheduler.js`: scheduler capacity resolution from agent settings.
- `packages/orchestrator/src/runnability-service.js`: runnability explanations use agent max task limits.
- `packages/board-service/src/index.js`: orchestrator status exposes per-agent max task limits.
- `apps/web/src/components/SettingsDialog.tsx`: settings controls for global and agent task limits.
- `apps/web/src/components/Board.tsx`: column task count badge.
- `apps/web/src/components/OrchestratorPanel.tsx`: chart uses agent max task limits.
- `apps/web/src/styles.css`: column badge styling.
- `apps/web/src/types.ts`, `packages/schemas/src/index.js`: updated settings types/schema.

## Validation

- `rtk pnpm exec node --test tests/unit/scheduler.test.js`
- `rtk pnpm exec node --test tests/unit/schemas.test.js --test-name-pattern "schemas parse"`
- `rtk pnpm exec node --test --test-name-pattern "scheduler explains global limits" tests/unit/orchestrator.test.js`
- `rtk pnpm exec node --test --test-name-pattern "settings scopes map" tests/unit/orchestrator.test.js`
- `rtk pnpm lint`
- Browser validation at `http://127.0.0.1:15002/`: DOM showed column badges `0/0/0/4`, runtime input `1000`, and agent max parallel tasks input `50`.
