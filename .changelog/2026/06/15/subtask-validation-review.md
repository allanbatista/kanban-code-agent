# Subtask Validation Review

Date: 2026-06-15

## Changed

- Prevented successful subtask validation from requeueing the same agent run; validated subtasks now wait for parent review.

## Files

- `packages/orchestrator/src/spec-workflow-service.js`: routes successful subtask validation to `waiting_review` and requeues the parent.
- `tests/unit/orchestrator.test.js`: covers validation-recorded subtasks not rerunning.

## Validation

- `rtk node --check packages/orchestrator/src/spec-workflow-service.js`
- `rtk pnpm exec node --test --test-name-pattern "subtask validation record waits" tests/unit/orchestrator.test.js`
- `rtk pnpm exec node --test --test-name-pattern "spec-first workflow gates|subtask review request queues|subtask review gate pass" tests/unit/orchestrator.test.js`
