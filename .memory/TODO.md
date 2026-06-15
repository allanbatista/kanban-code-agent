# [medium]Persist real task and chat uploads

Task modal and assistant chat now accept file selection/drag-drop in the UI and pass attachment names to the assistant prompt, but binary upload persistence is not implemented because the current daemon contract has no upload endpoint/storage flow. Next step: add backend file upload support and wire selected files to task storage/chat messages.

# [medium] Centralize Remaining Workflow FSDB Adapter Calls

The public orchestrator facades are thin, command dispatch now uses `CommandBus` handler registration, and task/chat/decomposition workflows are split into dedicated services. Some workflow services still call concrete FSDB helpers for runtime events, chat compaction, agent settings, projects, and task lifecycle details. This is non-blocking for the refactor-plan DoD because public contracts, buses, services, projections, and validations pass. Next step: add narrower runtime/chat/project ports and inject them into workflow services.

# [high] Implement real per-task filesystem sandbox

Current task agent scoping is prompt-only plus cwd/worktree conventions. This does not technically prevent absolute-path reads/writes outside the task sandbox. Next step: add real filesystem isolation for each task agent run, such as process/container sandboxing or SDK-level permission enforcement, while preserving KCA tool access to task artifacts.

# [minor] Re-run feature workflow audit after unrelated dirty worktree is cleaned

The manager task scope implementation passed unit/build/browser validation, but the feature workflow audit script failed because the repository already contains many unrelated modified/untracked files outside this feature scope. Re-run the audit after those unrelated changes are committed or cleaned.

# [medium] Verify Pi builtin tool suppression

KCA now filters custom task tools and routes validation through `run_command`, but SDK-level builtin tools such as `subagent` still need a real Pi smoke test to prove they are suppressed or harmless in task sessions. Next step: run a real provider session and enforce SDK-level builtin disable if active tools still include host-capability builtins.

# [medium] Reconcile stuck KCA-586551 tasks after manager routing fix

Existing tasks KCA-586551 and KCA-586551-01 were already left in `running` before the routing/logging fix because the agent emitted text but did not call a terminal tool. KCA-586551-02 remains queued behind `weather-data`. Next step: rerun or manually complete/requeue those tasks after deciding whether to preserve their current artifacts.

# [medium] Fix pre-existing orchestrator autoStart test failures

The full `tests/unit/orchestrator.test.js` run failed before the new manager routing test in autoStart scenarios where expected `running` tasks remained `idle`. Next step: isolate the existing autoStart regression and rerun the full orchestrator suite after that fix.

# [minor] Mark manager routing plan final after unrelated dirty worktree is clean

The manager routing observability implementation passed focused unit tests, adapter tests, typecheck, browser validation, and the feature workflow audit while kept `IN_PROGRESS`. The plan cannot be safely marked final while many unrelated modified/untracked files remain in `git status`. Next step: mark the plan final after unrelated worktree changes are committed or cleaned.

# [medium] Recover stuck KCA-441612 generalist run

Task KCA-441612 was left stuck after the OpenAI-compatible adapter returned `terminal:false` without `emit_artifact`, `complete_task`, or `report_blocker`; it was hard-interrupted during the 2026-06-13 validation cleanup. Next step: decide whether to rerun it or leave it superseded by smoke task KCA-349798.

# [high] Complete tool result persistence and resume rehydration

The validation fix made `run_command` output visible to OpenAI-compatible model turns and added non-terminal recovery, but the full `.features/20260613-2100-tool-result-persistence/plan.md` scope is not complete. Remaining work: persist durable model-facing previews/result refs into command indexes/events, restore recent tool results on resumed prompts, and add orchestrator tests for non-terminal lease recovery and resumed prompt rehydration.

# [medium] Full orchestrator unit suite has existing failures

`rtk node --test tests/unit/orchestrator.test.js tests/unit/pi-adapter.test.js` failed in existing scheduler/assistant tests where tasks stayed `idle` instead of `running` and assistant command assertions returned undefined. New file metadata/prompt tests passed before the suite was stopped. Next step: investigate scheduler/assistant regressions separately from agent response/file actions.

# [medium] Re-run broad unit suite after scheduler assistant regressions

The agent usage model implementation passed focused typecheck, syntax, adapter usage, aggregate usage, and E2E usage validation. The broad `rtk node --test tests/unit/pi-adapter.test.js tests/unit/orchestrator.test.js` run showed scheduler/assistant failures outside the focused usage tests and did not finish cleanly. Next step: fix or isolate those existing regressions, then rerun the broad suite.

# [medium] Fix broad orchestrator suite failures before claiming full regression coverage

`rtk pnpm exec node --test --test-name-pattern "scheduler explains|settings scopes" tests/unit/orchestrator.test.js` was initially invoked with the filter after the file and ran the broad orchestrator suite. It finished with 44 passing, 12 failing, and 1 skipped. Focused checks for this implementation pass, but full-suite validation remains blocked by assistant chat, stale completion, file lock, decomposition, handoff, and chat compaction failures. Next step: triage those orchestrator failures separately and rerun the broad suite.

# [medium] Complete final workflow P2 production hardening

P1 workflow settings, operational UI panels, formal planning/delivery artifacts, and stricter gates are implemented. Remaining P2 hardening from `final-workflow-definition.output.md`: real per-task sandbox enforcement, complete retry/timeout resume rehydration, current-state validation with browser/API/logs, formal Documentation Agent, adversarial review for high-risk tasks, operational docs, and throughput/failure/blocked/DoD metrics. Next step: split these into implementation plans and start with real sandbox enforcement.

# [high] Align implementation with recursive swarm workflow

`agent-workflow.md` defines Task/Subtask as one recursive entity with manager/assignee ownership, waiting review/response states, recursive approval unwinding, and hard max-depth control. Current implementation only partially supports this through `worktree.parentTaskId`, `subtasks.yaml`, queued/running/waiting/done statuses, and scheduler semaphores. Missing work: first-class parent/depth fields, Waiting Review/Waiting Response semantics, per-subtask manager approval/rejection, recursive review unwinding, and hard max-depth/fan-out enforcement. Next step: design schema/status migration and gate changes before implementation.

# [high] Complete real DeepSeek recursive swarm validation

Implementation and deterministic orchestration validation passed, but the real DeepSeek execution using provider `deepseek`, model `deepseek-v4-flash`, and minimal effort did not return from the first scheduler tick within the required 5 minute validation window. Next step: inspect the OpenAI-compatible request/stream timeout path for DeepSeek, add a hard per-agent prompt timeout, then rerun the exact 4-subtask validation task end to end.

# [medium] Re-run broad orchestrator pattern validation

Focused recursive swarm unit tests passed individually, but the broad `rtk pnpm exec node --test --test-name-pattern "decompose|subtask|comment|interrupt|pause|cancel|review" tests/unit/orchestrator.test.js` run was canceled after hanging at the file runner level. Next step: split or mark slow tests, then rerun the broad command required by the feature plan.

# [high] Finish DeepSeek recursive swarm review loop

Real DeepSeek validation with provider `deepseek`, model `deepseek-v4-flash`, and minimal effort reached Product/spec creation and four child subtasks in `waiting_review`, but the parent entered a Manager/Product confirmation loop and the run hit the 310s external timeout before reviewing children and completing the parent. Next step: stop recursive scheduler drains from re-entering Product/Manager loops during active tool execution or add a hard end-to-end validation driver, then rerun the exact 4-subtask validation within 5 minutes.

# [medium] Triage current full orchestrator suite failures

`rtk pnpm exec node --test tests/unit/orchestrator.test.js` finished with 62 passing and 11 failing after the recursive swarm fixes. Focused tests for the touched paths pass, but full-suite regression coverage remains blocked by assistant-model expectation failures: generated title mismatch, assistant chat action shape/routing mismatches, file-lock blocker text mismatch, invalid DAG reroute expectation, fast research artifact missing, persona handoff route mismatch, and auto-compact evidence missing. Next step: triage those assistant workflow tests separately and rerun the full orchestrator suite.
