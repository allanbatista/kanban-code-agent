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
