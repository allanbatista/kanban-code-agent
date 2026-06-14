# Human Wait Runnability

Date: 2026-06-14

## Changed

- Prevented tasks in `human_wait` from being considered runnable.
- Preserved task state when an agent terminal tool mutates a task without changing column/status.

## Files

- `packages/orchestrator/src/runnability-service.js`: blocks `human_wait` in runnability checks.
- `packages/orchestrator/src/task-agent-workflow-service.js`: detects `updatedAt` mutations and preserves human-wait routing.
- `tests/unit/scheduler.test.js`: adds human-wait runnability coverage.

## Validation

- `rtk node --test --test-name-pattern "human wait tasks are not runnable" tests/unit/scheduler.test.js`
- `rtk pnpm lint`
