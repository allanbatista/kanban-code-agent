# Final Task Answer Visibility

Date: 2026-06-14

## Changed

- Persist the agent's final visible answer in task chat when `complete_task` completes a run.

## Files

- `packages/pi-adapter/src/index.js`: carries latest assistant text into `agent.complete_task`.
- `packages/agent-runtime/src/index.js`: passes the assistant-text getter into task tools.
- `packages/orchestrator/src/task-agent-workflow-service.js`: stores final text in visible task chat.
- `packages/schemas/src/index.js`: accepts optional `finalText` on completion commands.
- `tests/unit/pi-adapter.test.js`: covers OpenAI-compatible final text propagation.
- `tests/unit/orchestrator.test.js`: covers visible chat persistence on completion.

## Validation

- `rtk node --check packages/pi-adapter/src/index.js && rtk node --check packages/agent-runtime/src/index.js && rtk node --check packages/orchestrator/src/task-agent-workflow-service.js && rtk node --check packages/schemas/src/index.js`
- `rtk node --test --test-name-pattern "openai compatible adapter executes task tool calls" tests/unit/pi-adapter.test.js`
- `rtk node --test --test-name-pattern "complete task persists final text in visible task chat" tests/unit/orchestrator.test.js`
