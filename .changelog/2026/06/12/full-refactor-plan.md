# Full Refactor Plan

Date: 2026-06-12

## Changed

- Added BoardService, TaskService, repository ports/adapters, QueryBus, CommandBus facade, EventBus, BoardProjection, RunnabilityService, and split workflow services for hooks, persona handoff, gates, and merge.
- Routed `/api/state` and generic queries away from orchestrator-owned `board.snapshot`.
- Reduced `packages/orchestrator/src/index.js` to a one-line facade and moved command type registry to application handlers.
- Reduced `packages/orchestrator/src/orchestrator-service.js` to a one-line facade and moved workflow command implementation into `workflow-command-handlers.js`.
- Replaced the final workflow command `if (command.type === ...)` dispatcher with explicit command handler registration through `CommandBus`.
- Split task agent, agent chat, and task decomposition workflows into dedicated orchestrator workflow service modules.
- Routed daemon command, scheduler, and external FSDB watcher notifications through EventBus.
- Removed the frontend `refetchInterval: 3000` polling loop so board refreshes rely on command/SSE invalidation.
- Added service/repository/bus unit coverage and local-prod HTTP/SSE/WS/browser validation evidence.

## Files

- `apps/daemon/src/server.js`: uses BoardService for state/projection invalidation and external FSDB change detection.
- `apps/web/src/main.tsx`: disables React Query interval/focus refetch polling.
- `packages/application/src/*`: command/query/event bus and supporting services.
- `packages/application/src/handlers/command-handlers.js`: public command registry.
- `packages/board-service/src/*`: board read model service and projection cache.
- `packages/task-service/src/index.js`: task mutation service.
- `packages/ports/src/index.js`: repository port contracts.
- `packages/fsdb/src/repositories/index.js`: FSDB repository adapters.
- `packages/orchestrator/src/*`: public facades, workflow command handlers, runnability service, and workflow service splits.
- `packages/orchestrator/src/agent-chat-workflow-service.js`: agent chat workflow split.
- `packages/orchestrator/src/task-agent-workflow-service.js`: task agent lifecycle workflow split.
- `packages/orchestrator/src/task-decomposition-service.js`: task decomposition workflow split.
- `tests/unit/refactor-services.test.js`: service, repository, bus, and runnability coverage.

## Validation

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test:e2e`
- Local-prod HTTP/SSE/WS probe passed.
- Local-prod Playwright browser probe passed with external FSDB edit UI update and stable-window no idle `/api/state` polling (`stateRequests: 11`, `beforeIdle: 11`).
