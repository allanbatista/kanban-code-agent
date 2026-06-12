# Feature Parity Spec v2

Date: 2026-06-12
Status: PRODUCT_READY_VALIDATED

## Definition of Ready

- App boots locally through daemon/web E2E.
- A user can create a task, run it, decompose it, edit acceptance, chat globally and per task, and see persisted state after reload.
- Scheduler autonomously starts queued runnable tasks with semaphores and limits.
- Roles, planning DAG, worktrees, merge, review and deployment paths are implemented with tests.

## Evidence

- `rtk pnpm lint`: passed.
- `rtk pnpm build`: passed.
- `rtk pnpm test:unit`: 43 tests, 41 passed, 2 skipped Pi real-only in fake unit mode.
- `rtk pnpm test:pi`: 5 passed.
- `rtk pnpm test:e2e`: 12 passed with clean Playwright storage.

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
