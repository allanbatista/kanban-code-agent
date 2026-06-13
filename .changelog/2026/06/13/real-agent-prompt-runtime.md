# Real Agent Prompt Runtime

Date: 2026-06-13

## Changed

- Separated Pi session creation timeout from task prompt execution timeout so real agents are not failed after 2.5s while thinking.
- Preserved task state produced by agent tools during a prompt instead of overwriting terminal results back to `running`.
- Added optional real Pi prompt/tool smokes for direct custom tools and a chained multi-persona orchestrator flow.

## Files

- `packages/pi-adapter/src/index.js`: separates session and prompt timeouts, records prompt acceptance, and supports task tool factories.
- `packages/orchestrator/src/task-agent-workflow-service.js`: records clear failure reasons and preserves tool-mutated task state.
- `tests/unit/pi-adapter.test.js`: covers timeout split and optional real prompt/tool smoke.
- `tests/unit/orchestrator.test.js`: covers terminal tool state and optional real chained Product -> Design -> Generalist -> Engineering -> Quality -> Review flow.

## Validation

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk env KCA_PI_REAL_TESTS=1 KCA_PI_PROMPT_SMOKE=1 KCA_TASK_AGENT_TIMEOUT_MS=120000 node --test tests/unit/pi-adapter.test.js`
- `rtk env KCA_PI_ADAPTER=fake KCA_PI_ORCH_PROMPT_SMOKE=1 KCA_TASK_AGENT_TIMEOUT_MS=180000 node --test tests/unit/orchestrator.test.js`
- `rtk env KCA_WEB_PORT=15111 KCA_E2E_DAEMON_PORT=15110 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15110 pnpm test:e2e`
- `rtk pnpm build`
