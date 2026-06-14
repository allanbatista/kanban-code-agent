# Subtask Runtime Validation Fixes

Date: 2026-06-14

## Changed

- Added self-contained descriptions and acceptance files for decomposed subtasks.
- Exposed description, expected output, and acceptance criteria fields in `spawn_subtasks`.
- Increased real provider adapter turn budget through `runtime.agentMaxTurns`, defaulting to 24.
- Kept waiting parents queued only after all direct subtasks finish and forced completed subtasks to end in `done`.
- Prevented duplicate subtask spawning and completed all-done parents instead of sending them to human wait.
- Fixed WIP checks so queued tasks do not count themselves against the column limit.
- Stopped scheduler drain immediately after `task.decompose`.
- Added deterministic parent fallback consolidation when all direct subtasks are already done.

## Files

- `packages/orchestrator/src/task-decomposition-service.js`: persists subtask context and acceptance.
- `packages/pi-adapter/src/index.js`: expands `spawn_subtasks` tool schema.
- `packages/agent-runtime/src/index.js`: passes adapter max turns to OpenAI-compatible sessions.
- `packages/orchestrator/src/task-agent-workflow-service.js`: requeues waiting parents only after all direct subtasks are done.
- `packages/orchestrator/src/runnability-service.js`: excludes the checked task from column WIP counts.
- `packages/orchestrator/src/workflow-command-handlers.js`: avoids auto-running a parent immediately after decomposition.

## Validation

- `rtk node --check packages/orchestrator/src/task-decomposition-service.js`
- `rtk node --check packages/pi-adapter/src/index.js`
- `rtk node --check packages/agent-runtime/src/index.js`
- `rtk node --check packages/orchestrator/src/task-agent-workflow-service.js`
- `rtk node --check packages/orchestrator/src/runnability-service.js`
- `rtk node --check packages/orchestrator/src/workflow-command-handlers.js`
- `rtk pnpm test:unit`
- DeepSeek real rerun: scenario 4 passed in 86.552s at `/tmp/kca-subtask-validation-rerun-TpTMZU`, task `KCA-602055`.
- Mechanical subtask workflow check passed at `/tmp/kca-subtask-mechanism-2zAhnM`: parent requeued only after 4/4 direct subtasks reached `done`.
- DeepSeek flash composed rerun reached final parent `done` in 76.089s at `/tmp/kca-subtask-s5-flash-done-4pSLfb`, parent `KCA-763797`, counters total 4, done 4, running 0; remaining gap recorded in `.memory/TODO.md` because the cold-country child did not persist the full ranked list as final visible output.
- DeepSeek flash standalone scenarios 1-3 passed at `/tmp/kca-standalone-flash-9zr0QE`: scenario 1 in 4.303s, scenario 2 in 4.573s, scenario 3 in 19.675s.
- DeepSeek flash standalone scenario 4 passed at `/tmp/kca-s4-flash-eNpr4e`: task `KCA-373533`, 64.320s, status `done`, `py_compile` OK.
- DeepSeek flash composed scenario 5 passed at `/tmp/kca-s5-flash-pass-lwsMmu`: parent `KCA-908052`, 79.372s, 4 direct subtasks, all `parentTaskId`/`mainTaskId` correct, counters total 4, done 4, running 0, final parent `done`.
