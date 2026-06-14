# Agent Context Fast Research

Date: 2026-06-13

## Changed

- Routed concrete direct research tasks to Generalist without Product/Engineering/Quality loops.
- Required Product to persist `acceptance.md` before handoff and gave Generalist `run_command` for evidence gathering.
- Compacted workflow tool results returned to models to avoid transcript bloat after handoffs.
- Added storage amendments for existing Product/Generalist prompts and Generalist tools.
- Added Manager/Product hard-stop guidance so unavailable live sources block or ask for input instead of continuing with estimates.
- Allowed `agent.emit_artifact` to update root `acceptance.md` so Product can replace generated placeholder acceptance.
- Bounded direct research live-data retries to avoid looping on empty or failing external sources.
- Added deterministic SLA coverage proving the target research task reaches `done` through `manager -> generalist` in under 120 seconds.

## Files

- `packages/agent-runtime/src/index.js`: direct operational routing context.
- `packages/fsdb/src/index.js`: default prompt/tool updates and existing-storage amendments.
- `packages/core/src/roles.js`: Generalist role tool/gate update.
- `packages/orchestrator/src/task-agent-workflow-service.js`: root task contract artifact handling.
- `packages/pi-adapter/src/index.js`: compact tool result and `run_command` guidance.
- `tests/unit/orchestrator.test.js`: routing, prompt, and amendment coverage.
- `tests/unit/pi-adapter.test.js`: compact tool result coverage.

## Validation

- `rtk node --test --test-name-pattern='manager prompt|product and generalist prompts|storage init amends' tests/unit/orchestrator.test.js`
- `rtk node --test --test-name-pattern='task agent tools' tests/unit/pi-adapter.test.js`
- `rtk node --check packages/agent-runtime/src/index.js && rtk node --check packages/fsdb/src/index.js && rtk node --check packages/core/src/roles.js && rtk node --check packages/pi-adapter/src/index.js && rtk node --check tests/unit/orchestrator.test.js && rtk node --check tests/unit/pi-adapter.test.js`
- Real Pi smoke: task `KCA-178829` completed `manager -> generalist -> done` in 39s under `/tmp/tmp.nmPvTBm1OZ`.
- `rtk node --test --test-name-pattern='fast research contract|storage init amends|input/artifact tools' tests/unit/orchestrator.test.js`
- `rtk node --test --test-name-pattern='manager prompt' tests/unit/orchestrator.test.js`
- `rtk node --check packages/fsdb/src/index.js`
- `rtk node --check packages/orchestrator/src/task-agent-workflow-service.js`
- `rtk node --check tests/unit/orchestrator.test.js`
- `rtk node --test --test-name-pattern='fast research|manager prompt|storage init amends|product and generalist prompts' tests/unit/orchestrator.test.js`
- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk env KCA_WEB_PORT=15121 KCA_E2E_DAEMON_PORT=15120 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15120 pnpm test:e2e`
