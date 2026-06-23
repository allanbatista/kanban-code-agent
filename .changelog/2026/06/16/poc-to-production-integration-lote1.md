# POC → Production Integration (Lote 1/5)

Date: 2026-06-16

## Changed

- T01: web/ scaffold — vite proxy to API, vitest config, test scripts
- T02: API client — typed fetch wrappers for tasks, agents, projects, settings, health
- T03: WebSocket React hook — auto-reconnect, subscribe/unsubscribe, Zustand dispatch
- T04: Zustand stores — agent-store (API-backed), kanban-store (API + WS wired)

## Files

- `web/package.json`: added `test`/`test:watch` scripts, `vitest` devDep
- `web/vite.config.ts`: added `/api` and `/ws` proxy to backend
- `web/vitest.config.ts`: new vitest config with `@` alias
- `web/src/hooks/useWebSocket.ts`: new React WebSocket hook
- `web/src/stores/agent-store.ts`: new Zustand agent store
- `web/src/__tests__/api.test.ts`: tests for API client (8)
- `web/src/hooks/__tests__/useWebSocket.test.ts`: tests for WebSocket hook (4)
- `web/src/stores/__tests__/agent-store.test.ts`: tests for agent store (3)
- `web/src/stores/__tests__/kanban-store.test.ts`: tests for kanban store (7)

## Validation

- `cd web && pnpm vitest run` — 23/23 tests pass across 4 files
