# Kanban Code Agent MVP Scaffold

Date: 2026-06-11

## Changed

- Added Node/pnpm workspace with Vite web app, local daemon, shared fixtures, and Playwright E2E tests.
- Reused `kanban-code-agent-mock-v4.html` as the initial web UI surface.
- Added FSDB helpers for YAML, Markdown and JSONL task storage.
- Added `kca` CLI commands for init, doctor, project add, task create/list/move.
- Added Zod schemas for task, command and query contracts.
- Added orchestrator command/query handling with command idempotency and `why_not_running`.
- Changed the daemon to use FSDB/orchestrator instead of a separate JSON state file.
- Connected core UI task/settings actions to daemon commands while preserving optimistic local UI state.
- Added fake agent runtime with persisted session JSONL and run summaries.
- Added orchestrator support for `task.run`, `task.interrupt`, `task.decompose`, `agent.complete_task`, and `agent.report_blocker`.
- Added `packages/git-worktree` with worktree creation, parent-checked subtask merge, and conflict-to-blocked handling.
- Connected task modal pause/resume/complete actions to daemon commands.
- Added scheduler checks for global task capacity, per-agent tokens, column WIP and semaphores.
- Added hook event execution on column entry.
- Added `agent.request_user_input` and `agent.emit_artifact` tool handling.
- Added initial UI snapshot loading from the daemon while preserving mock visual data.
- Fixed settings modal sizing to stay near 90%x80% and task modal split to stay 50/50 on mobile.
- Added Pi SDK adapter backed by `@earendil-works/pi-coding-agent@0.79.1`, with dry-run `createAgentSession` verification and deterministic fake fallback.
- Added `kca doctor` Pi diagnostics for SDK/API/auth file presence and dry-run session checks.
- Added daemon SSE stream at `/api/events` and UI subscription for command-result refresh.
- Added daemon WebSocket RPC at `/api/rpc` for command/query messages and UI WebSocket-first daemon client with HTTP/SSE fallback.
- Added scoped settings reads/writes for app subscopes, board/columns, hooks, agents, skills and projects backed by concrete settings files.
- Added Zod schemas for settings, board, projects, agents, hooks, skills, dependencies, worktree, subtasks and events.
- Added advanced CLI coverage for run, interrupt, decompose, merge, why, and doctor index rebuilds.
- Added richer FSDB artifacts for comments/subtasks, configurable agent/skill settings, and derived index rebuilds.
- Added board-chat daemon commands for task creation, movement, decomposition, and `why_not_running` explanations.
- Added stale-run protection after manual override and parent-level sequential merge gating.
- Added orchestrator worktree creation when a configured project repo is available.
- Added `kca task recover` and event replay snapshots/patches for rebuilding `task.yaml` from append-only events.
- Added E2E coverage for modal task edit, board-chat move persistence and settings modal save persistence.
- Added rich parent `subtasks.yaml` persistence during decomposition and scheduler project-token checks.
- Added E2E coverage for every task-modal tab and explicit Orchestrator panel content.
- Added real `command`/`script` hook execution with timeout, env context, output capture and persisted summaries/artifacts.
- Added core command/query/event contract constants and reusable test fixtures.
- Added daemon-backed `orchestrator.status` query for capacity, queue, running tasks, merges, worktrees and blockers.
- Added agent-session resume context using previous session refs and prior run summaries.
- Added worktree branch/dirty status summaries and explicit scheduler coverage for ready/dependent subtasks.
- Added filesystem skill directories with `SKILL.md` loading for configured agent skills.

## Files

- `package.json`: root scripts and dev dependencies.
- `pnpm-workspace.yaml`: workspace package globs.
- `apps/web/index.html`: visual UI based on the mock.
- `apps/daemon/src/server.js`: local JSON API and persisted state.
- `apps/cli/src/kca.js`: local CLI for storage/project/task commands.
- `packages/core/src/fixtures.js`: shared seed board/settings/tasks.
- `packages/core/src/contracts.js`: canonical command/query/event contracts.
- `packages/test-fixtures/src/index.js`: reusable board and command fixtures for tests.
- `packages/fsdb/src/index.js`: local-first storage helpers.
- `packages/schemas/src/index.js`: task/command/query validation.
- `packages/agent-runtime/src/index.js`: fake runtime/session helpers.
- `packages/pi-adapter/package.json`: real Pi SDK dependency.
- `packages/pi-adapter/src/index.js`: Pi SDK loader, dry-run AgentSession creation, prompt opt-in, and fake fallback session.
- `packages/orchestrator/src/index.js`: command and query handling.
- `packages/git-worktree/src/index.js`: git worktree and merge helpers.
- `apps/web/index.html`: daemon snapshot loading and execution controls.
- `tests/e2e/kanban.spec.js`: WebSocket RPC query coverage.
- `playwright.config.js`: isolated web port for E2E to avoid reusing unrelated local Vite servers.
- `tests/unit/fsdb-cli.test.js`: CLI/FSDB unit coverage including event-log recovery.
- `tests/unit/orchestrator.test.js`: orchestrator idempotency, scheduler, hook execution and query coverage.
- `tests/unit/git-worktree.test.js`: git worktree unit coverage.
- `tests/unit/pi-adapter.test.js`: Pi adapter fallback coverage.
- `tests/unit/schemas.test.js`: generated FSDB file/schema coverage.
- `tests/e2e/kanban.spec.js`: E2E coverage for UI task create/edit/move, task tabs, Orchestrator panel, settings, RPC/SSE and daemon.

## Validation

- `rtk pnpm install`
- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test` (27 unit tests and 9 E2E tests passed)
- `rtk env KCA_STORAGE_ROOT=/tmp/kca-doctor-smoke node apps/cli/src/kca.js doctor` (reports Pi SDK `@earendil-works/pi-coding-agent`, dry-run mode `real`, auth file absent)
- `rtk timeout 25s env KCA_STORAGE_ROOT=/tmp/kca-pi-smoke KCA_PI_RUN_PROMPT=1 node apps/cli/src/kca.js doctor --pi-smoke` (reports `ok: true`, SDK `@earendil-works/pi-coding-agent@0.79.1`, `promptSent: true`)
- `rtk env WEB_URL=http://127.0.0.1:5183 DAEMON_URL=http://127.0.0.1:4174 node tmp/e2e-validator/kanban-visual-parity/validate.mjs` (PASS desktop/mobile)
