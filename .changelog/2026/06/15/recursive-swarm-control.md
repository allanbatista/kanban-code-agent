# Recursive Swarm Control

Date: 2026-06-15

## Changed

- Added first-class recursive task metadata, depth enforcement, subtask review/response workflows, chain pause/resume/cancel, agent tools, prompt context, and UI controls.
- Hardened OpenAI-compatible runs with provider request timeout handling, adapter-failure task recovery, terminal handling for `review_subtask`/`answer_subtask_question`, Manager `approve_task_spec` access, and parent requeue when subtasks request review while the parent run is active.
- Fixed child review-gate pass routing so reviewed subtasks wait for parent Manager review instead of moving to deployment, reset stale DoR failures on spec approval, accepted common approved Product spec shapes, allowed explicit agent tool overrides to omit `delegate_task`, and made `run_command` tolerate single-string shell commands like `ls -la`.

## Files

- `packages/schemas/src/index.js`: task statuses, events, fields, and commands.
- `packages/fsdb/src/index.js`: task tree metadata and subtask summary counters.
- `packages/orchestrator/src/*`: recursive decomposition, review, question routing, chain controls, and lease release.
- `packages/agent-runtime/src/index.js`: recursive prompt context and required tools.
- `packages/orchestrator/src/gate-service.js`: subtask review-gate parent requeue.
- `packages/orchestrator/src/spec-workflow-service.js`: approved spec DoR handling.
- `packages/pi-adapter/src/index.js`: subtask review/answer tools, terminal tool handling, and provider request timeout.
- `packages/core/src/roles.js`: Manager spec approval tool access.
- `apps/web/src/*`: board/modal display and controls for recursive subtasks.
- `tests/unit/*`: focused schema, adapter, and orchestrator coverage.

## Validation

- `rtk pnpm exec node --test tests/unit/schemas.test.js`
- `rtk pnpm exec node --test tests/unit/pi-adapter.test.js`
- Focused orchestrator tests for decomposition, max depth, review, response, pause/resume/cancel.
- Focused orchestrator tests for adapter failure recovery and parent requeue during subtask review.
- `rtk pnpm -C apps/web typecheck`
- `rtk pnpm lint`
- `rtk env KCA_WEB_PORT=15101 KCA_E2E_DAEMON_PORT=15100 pnpm exec playwright test tests/e2e/kanban.spec.js`
- Real DeepSeek validation passed: `/tmp/kca-real-deepseek-kqAfNJ`, parent `KCA-177491`, `deepseek-v4-flash`, elapsed 167s, Product handoff/spec approval, DoR passed, exactly four work subtasks, 46ms first child-run window, all children and parent `done/done`.
- Full `rtk pnpm exec node --test tests/unit/orchestrator.test.js` was run and is not green: 62 passed / 11 failed in assistant-model expectation tests outside the focused touched paths.
