# Technical Design — POC → Production Integration

## Architecture Decisions

### AD-1: Frontend as Separate Package
- Create `web/` directory with own `package.json`
- React + Vite + shadcn/ui + Zustand (same stack as POC)
- Build output goes to `web/dist/`
- `swarm server` serves `web/dist/` statically

### AD-2: Real-Time via WebSocket
- Production already has WebSocket server at `/ws`
- Frontend creates `useWebSocket(url)` hook
- Subscribe to task updates by taskId
- Zustand store updates from WS messages
- Fallback: SSE at `/api/events` for environments without WS

### AD-3: Event-Driven Consistency
- POC uses EventEmitter — production uses same pattern
- All state changes emit events via `SwarmEventEmitter`
- Frontend subscribes to events, not polling
- Audit trail: every event persisted in NDJSON event log

### AD-4: Database as Filesystem
- Tasks: `./swarm/tasks/{taskId}/` (snapshot.json, events.ndjson, chat.jsonl)
- Projects: `./swarm/projects/{projectId}.json`
- Agents: config in `swarm.yml` or env vars
- No external database dependency

### AD-5: Convention over Configuration
- Default agent list hardcoded in domain types
- Default ports, paths, models from constants
- Override via `swarm.yml` or `SWARM_*` env vars
- Zero config to get started

## Component Map

### What to Port from POC (reuse logic, rewrite UI integration)

| POC Component | Action | Notes |
|---|---|---|
| `poc/index.ts` → Orquestrator logic | **Already ported** | `src/application/orquestrator.ts` exists |
| `poc/index.ts` → Task lifecycle | **Already ported** | Domain types exist |
| `poc/layout/src/components/` | **Port UI components** | Adapt to use real API |
| `poc/layout/src/stores/` | **Port + modify** | Replace mocks with fetch |
| `poc/layout/src/mocks/` | **Delete** | Replace with API calls |
| `poc/layout/src/hooks/` | **Port + modify** | Add useWebSocket |

### What to Create New

| Component | Location | Purpose |
|---|---|---|
| WebSocket hook | `web/src/hooks/useWebSocket.ts` | Real-time updates |
| API client | `web/src/lib/api.ts` | HTTP client for all endpoints |
| Agent definitions | `src/cli/orquestrator-factory.ts` | Add 3 missing agents |
| ProjectFileStore | `src/infrastructure/persistence/project-file-store.ts` | Persist projects |
| Graph endpoint | `src/infrastructure/api/routes/reports.ts` | Workflow graph data |
| Chat endpoint | `src/infrastructure/api/routes/tasks.ts` | Chat history stream |

## Integration Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (web/)                                         │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐            │
│  │ Kanban  │  │ Task     │  │ CreateTask  │            │
│  │ Board   │  │ Drawer   │  │ Dialog      │            │
│  └────┬────┘  └────┬─────┘  └──────┬──────┘            │
│       │            │               │                    │
│  ┌────┴────────────┴───────────────┴──────┐             │
│  │         Zustand Store                   │             │
│  │    (updated by WS + HTTP)              │             │
│  └────┬───────────────────────────┬───────┘             │
│       │ HTTP (fetch)              │ WS (useWebSocket)   │
└───────┼───────────────────────────┼─────────────────────┘
        │                           │
┌───────┼───────────────────────────┼─────────────────────┐
│  API  │ Fastify                   │ WebSocket            │
│       │                           │                      │
│  ┌────┴────┐  ┌──────────┐  ┌────┴─────┐               │
│  │ Routes  │  │ Events   │  │ WS       │               │
│  │ REST    │  │ SSE      │  │ Server   │               │
│  └────┬────┘  └────┬─────┘  └────┬─────┘               │
│       │            │              │                      │
│  ┌────┴────────────┴──────────────┴──────┐              │
│  │         Orquestrator                   │              │
│  │  (Scheduler, WorkerPool, Agents)       │              │
│  └────┬──────────────────────────────────┘              │
│       │                                                  │
│  ┌────┴──────────────────────────────────┐              │
│  │         Filesystem Persistence         │              │
│  │  EventStore, SnapshotStore, ProjectFS  │              │
│  └───────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

## File Structure After Integration

```
kanban-code-agent/
├── src/
│   ├── domain/
│   │   ├── types.ts              # existing
│   │   ├── entities/
│   │   │   └── task.ts           # existing (may need Project entity)
│   │   └── index.ts
│   ├── application/
│   │   ├── orquestrator.ts       # existing
│   │   ├── scheduler.ts          # existing
│   │   ├── worker-pool.ts        # existing
│   │   ├── pi-client.ts          # existing
│   │   └── ...
│   ├── infrastructure/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── tasks.ts      # existing (add chat endpoint)
│   │   │   │   ├── agents.ts     # existing
│   │   │   │   ├── projects.ts   # existing (add persistence)
│   │   │   │   ├── reports.ts    # NEW - graph/summary
│   │   │   │   └── events.ts     # existing
│   │   │   ├── http-server.ts    # existing
│   │   │   └── ws-server.ts      # existing
│   │   └── persistence/
│   │       ├── event-store.ts    # existing
│   │       ├── snapshot-store.ts # existing
│   │       └── project-file-store.ts  # NEW
│   └── cli/
│       ├── orquestrator-factory.ts  # add 3 agents
│       └── server.ts             # serve web/dist
├── web/                          # NEW
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/           # ported from poc/layout
│       ├── stores/               # ported, mocks removed
│       ├── hooks/
│       │   └── useWebSocket.ts   # NEW
│       └── lib/
│           └── api.ts            # NEW
└── poc/                          # kept as reference, deprecated
```

## API Changes

### New Endpoints

```
GET  /api/tasks/:taskId/chat          # Chat history (JSONL stream)
GET  /api/report/summary              # Execution summary table
GET  /api/report/graph                # Execution graph (for WorkflowView)
POST /api/tasks/:taskId/subtasks      # Create subtask via API
```

### Modified Endpoints

```
POST /api/projects                    # Now persists to filesystem
PUT  /api/projects/:projectId         # Now persists to filesystem
DELETE /api/projects/:projectId       # Now persists to filesystem
```

## Agent Definitions

Add to `src/cli/orquestrator-factory.ts`:

```typescript
// Architecture Agent
{ name: 'Architecture', model: defaultModel, systemPrompt: ARCHITECTURE_PROMPT }

// CodeReviewer Agent  
{ name: 'CodeReviewer', model: defaultModel, systemPrompt: CODE_REVIEWER_PROMPT }

// QA Agent
{ name: 'QA', model: defaultModel, systemPrompt: QA_PROMPT }
```

## Build Pipeline

```json
// web/package.json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Vite proxy config for dev:
```typescript
// web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true }
    }
  }
})
```
