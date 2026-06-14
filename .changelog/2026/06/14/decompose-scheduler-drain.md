# Decompose Scheduler Drain

Date: 2026-06-14

## Changed

- `task.decompose` now triggers scheduler drain so runnable subtasks can start automatically.
- Scheduler-related unit tests now force the fake Pi adapter when asserting runtime state.

## Files

- `packages/orchestrator/src/workflow-command-handlers.js`: includes `task.decompose` in scheduler drain policy.
- `tests/unit/orchestrator.test.js`: keeps scheduler/runtime assertions deterministic without real Pi sessions.
- `tests/unit/orchestrator-drain-policy.test.js`: covers the drain policy regression.

## Validation

- `rtk node --test tests/unit/orchestrator-drain-policy.test.js`
- `rtk env KCA_PI_ADAPTER=fake node --test tests/unit/orchestrator.test.js`
- `rtk pnpm test:unit`
