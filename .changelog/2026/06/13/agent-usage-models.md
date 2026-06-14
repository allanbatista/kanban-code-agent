# Agent Usage Models

Date: 2026-06-13

## Changed

- Added per-model token usage aggregation under each agent.
- Added model/provider display rows in the task execution usage table.

## Files

- `packages/fsdb/src/index.js`: aggregates usage by agent and model.
- `packages/agent-runtime/src/index.js`: records resolved run model in task events.
- `apps/web/src/components/TaskModal.tsx`: renders model rows below each agent summary.
- `apps/web/src/types.ts`: adds per-model usage types.
- `tests/unit/orchestrator.test.js`, `tests/unit/pi-adapter.test.js`, `tests/e2e/kanban.spec.js`: cover model usage persistence, aggregation, and UI.

## Validation

- `rtk pnpm --dir apps/web exec tsc -p tsconfig.json --noEmit`
- `rtk node --check packages/fsdb/src/index.js && rtk node --check packages/agent-runtime/src/index.js && rtk node --check packages/pi-adapter/src/index.js`
- `rtk node --test --test-name-pattern "openai compatible adapter emits only real provider usage" tests/unit/pi-adapter.test.js`
- `rtk node --test --test-name-pattern "task usage aggregates into board snapshot, files and logs" tests/unit/orchestrator.test.js`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-usage-models pnpm exec playwright test tests/e2e/kanban.spec.js -g "shows real token usage"`
