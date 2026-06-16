# Durable Agent Resume

Date: 2026-06-15

## Changed

- Reworked the swarm POC so waiting agents are suspended to persisted task/event state and resumed by scheduler conditions.
- Persisted Pi session file paths per task and reopened them on resume.
- Added a restart simulation flow with `--simulate-restart`.

## Files

- `index.ts`: adds durable task/event state, persisted Pi session reuse, scheduler-based resume, and restart simulation.
- `.features/20260615-1254-durable-agent-resume/plan.md`: records contract, DoD, plan, and validation evidence.

## Validation

- `rtk yarn typecheck`
- `rtk yarn start`
- `rtk yarn start "crie uma subtask para Generic responder apenas ok e aguarde ela finalizar antes de dar o resultado final"`
- `rtk yarn start --simulate-restart "crie uma subtask para Generic responder apenas ok e aguarde ela finalizar antes de dar o resultado final"`
