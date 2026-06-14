# Tool Result Persistence Validation

Date: 2026-06-13

## Changed

- Made OpenAI-compatible task tool results expose `run_command` stdout/stderr/cwd/exit code to the model.
- Treated text-only adapter exits as non-terminal recoverable exits instead of leaving tasks running.
- Kept `emit_artifact` non-terminal and capped requested `run_command` timeouts at 120s.

## Files

- `packages/pi-adapter/src/index.js`: formats tool result content, adjusts terminal tool semantics, adds non-terminal reasons, caps command timeout.
- `packages/orchestrator/src/task-agent-workflow-service.js`: routes non-terminal adapter exits back to Manager and releases leases.
- `tests/unit/pi-adapter.test.js`: covers visible command output, non-terminal responses, and timeout capping.

## Validation

- `rtk node --test --test-name-pattern='run_command|non-terminal|openai compatible adapter executes' tests/unit/pi-adapter.test.js`
- Smoke task `KCA-349798`: completed to `done` in 40s with final task message containing 10 countries and temperatures from Open-Meteo.
