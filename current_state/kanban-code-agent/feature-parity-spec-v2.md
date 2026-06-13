# Feature Parity Spec v2

Date: 2026-06-13
Status: PRODUCT_READY_VALIDATED

## Definition of Ready

- App boots locally through daemon/web E2E.
- A user can create a task, run it, decompose it, edit acceptance, chat globally and per task, and see persisted state after reload.
- Scheduler autonomously starts queued runnable tasks with semaphores and limits.
- Roles, planning DAG, worktrees, merge, review and deployment paths are implemented with tests.
- Task-agent Pi bridge sends real prompts, registers workflow tools, records tool calls/results, and startup recovery fails stale `promptSent:false` runs instead of leaving them `running`.

## Evidence

- `rtk pnpm lint`: passed.
- `rtk pnpm build`: passed.
- `rtk pnpm test:unit`: 68 tests, 64 passed, 4 optional real-Pi tests skipped in fake unit mode.
- `rtk pnpm test:pi`: 8 passed, 1 optional real prompt smoke skipped by default.
- `rtk env KCA_PI_REAL_TESTS=1 KCA_PI_PROMPT_SMOKE=1 KCA_TASK_AGENT_TIMEOUT_MS=120000 node --test tests/unit/pi-adapter.test.js`: 9 passed.
- `rtk env KCA_PI_ADAPTER=fake KCA_PI_ORCH_PROMPT_SMOKE=1 KCA_TASK_AGENT_TIMEOUT_MS=180000 node --test tests/unit/orchestrator.test.js`: 31 passed.
- `rtk env KCA_WEB_PORT=15111 KCA_E2E_DAEMON_PORT=15110 KCA_E2E_STORAGE_ROOT=tmp/playwright-fsdb-15110 pnpm test:e2e`: 15 passed with clean Playwright storage.
- Real Pi chained workflow smoke: one task moved Product -> Design -> Generalist -> Engineering -> Quality -> Review -> Done with `promptSent:true`, `agent.tool_call`, and `agent.tool_result` evidence for each persona.
- HTTP probes passed for `/health`, `/api/state`, `/api/query`, `/api/command`, `/api/events`, and `WS /api/rpc`.
- Browser validation created and reloaded task `KCA-204138`; screenshot: `current_state/kanban-code-agent/browser-validation-20260612.png`.
- Live recovery evidence: stale task `KCA-952327` moved from `running` with `promptSent:false` to `failed` with `prompt_not_sent`.

## AC Matrix

| AC | Status | Evidence |
|---|---|---|
| Boot local | Done | E2E starts daemon/web and `/health` passes. |
| Create task | Done | E2E creates task through UI and persists in FSDB. |
| Autonomous run | Done | E2E scheduler auto-starts queued task. |
| Concurrent roles | Done | Unit scheduler starts queued tasks up to limits; role defaults validated. |
| Scheduler real | Done | `scheduler.tick`, daemon loop and E2E auto-start. |
| Semaphores | Done | Unit acquire/release and UI leases panel. |
| Planning DAG | Done | Unit DAG validator and N=6 decomposition. |
| Chats | Done | E2E reload persists board and task chat. |
| Worktrees/merge | Done | Git fixtures cover parent/child, merge and conflict. |
| Review/deploy | Done | Unit review gate and deployment command runner. |
| Prompt/tool bridge | Done | Real Pi prompt/tool smoke and chained persona smoke plus unit coverage for `agent.prompt_sent`, `agent.tool_call`, and `agent.tool_result`. |
| Stale run recovery | Done | Startup recovery and unit test fail `promptSent:false` runs. |
