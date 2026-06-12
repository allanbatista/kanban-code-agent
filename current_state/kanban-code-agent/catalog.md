# Kanban Code Agent Current-State Catalog

Date: 2026-06-12

## Runtime Surface

- Daemon: `apps/daemon/src/server.js` exposes `/health`, `/api/state`, `/api/query`, `/api/command`, SSE and WebSocket RPC.
- Web UI: `apps/web/src/App.tsx` connects board, assistant, task modal, settings and orchestrator panel.
- FSDB: `packages/fsdb/src/index.js`, `packages/fsdb/src/chat-store.js`, `packages/fsdb/src/runtime-store.js`.
- Orchestrator: command/query handling plus scheduler, merge, review, deployment and planning services.

## Implemented Capabilities

- Roles: manager, product, design, engineering, quality, review, deployment.
- Task lifecycle: create, update, file write, move, run, interrupt, complete, decompose, merge.
- Scheduler: daemon loop, `scheduler.tick`, semaphore leases, runnable queue, dependency blocking.
- Planning: `planning.yaml`, acceptance, `subtasks@2`, DAG validation.
- Chat: board/task JSONL history with UI reload persistence.
- Worktrees: parent feature and child task worktrees, sequential merge, conflict blocking.
- Review/deployment: blocking review findings and command-based deployment record with rollback.

## Validation Catalog

- Unit: `tests/unit/*.test.js`.
- E2E: `tests/e2e/kanban.spec.js`.
- Build: `pnpm --filter @kca/web build`.
- Evidence command set: `rtk pnpm lint`, `rtk pnpm build`, `rtk pnpm test:unit`, `rtk pnpm test:pi`, `rtk pnpm test:e2e`.
