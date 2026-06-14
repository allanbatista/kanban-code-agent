# Generate Title Before Run

Date: 2026-06-14

## Changed

- Generate a missing task title with the default model before the agent prompt is sent.

## Files

- `packages/orchestrator/src/task-agent-workflow-service.js`: adds pre-run title generation.
- `tests/unit/orchestrator.test.js`: covers generated title before agent prompt.

## Validation

- `rtk env KCA_PI_ADAPTER=fake node --test tests/unit/orchestrator.test.js`
