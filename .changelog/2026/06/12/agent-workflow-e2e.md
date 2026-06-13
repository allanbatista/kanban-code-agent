# Agent Workflow E2E

Date: 2026-06-12

## Changed

- Task-agent runs now send Pi prompts, register workflow tools, persist prompt/tool events, and reject explicit no-prompt runs as non-running.
- Added stale run recovery, atomic semaphore locking, invalid DAG blocker handling, and configured-project missing repo blocking.
- Recorded product validation evidence and browser screenshot.

## Files

- `packages/pi-adapter/src/index.js`: added task-agent workflow tools and prompt execution support.
- `packages/agent-runtime/src/index.js`: sends task prompts and records prompt/tool evidence.
- `packages/orchestrator/src/*.js`: added run guards, recovery, DAG failure handling, and workflow command coverage.
- `packages/fsdb/src/runtime-store.js`: serialized semaphore read-modify-write with a filesystem lock.
- `apps/daemon/src/server.js`: runs stale-run recovery on startup.
- `tests/unit/*.test.js`: added prompt, tool, DAG, semaphore, missing repo, and recovery coverage.
- `.features/20260612-1608-agent-workflow-e2e/plan.md`: recorded final evidence.

## Validation

- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test:unit`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
- HTTP/SSE/WS probes and `agent-browser` validation passed.
