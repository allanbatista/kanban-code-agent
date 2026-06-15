# Event-driven Subtasks

Date: 2026-06-15

## Changed

- Replaced hardcoded Manager/Product subtask spawning with an AI-callable `create_subtask` tool.
- Added event-driven parent resumption for `WAIT_ALL` and `ON_DEMAND` subtask completion modes.
- Removed high-thinking default and made the POC task configurable by CLI argument.

## Files

- `index.ts`: adds tool-based subtask creation, structured agent decisions, event notifications, and final result output.
- `.memory/RULES_AND_DEFINITION.md`: records the event-driven subtask orchestration rule.

## Validation

- `rtk yarn typecheck`
- `rtk yarn start`
- `rtk yarn start "crie uma subtask para Generic responder apenas ok e aguarde ela finalizar antes de dar o resultado final"`
