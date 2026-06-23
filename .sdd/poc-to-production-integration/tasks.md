# Tasks — POC → Production Integration

## Phase 1: Foundation (Frontend Setup)

- [x] **T01: Create web/ package scaffold**
  - Create `web/package.json` React, Vite, shadcn/ui, Zustand, @dnd-kit dependencies
  - Create `web/vite.config.ts` proxy API
  - Create `web/tsconfig.json`, `web/index.html`
  - Create `web/src/main.tsx`, `web/src/App.tsx` entry points
  - Files: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`
  - Effort: ~120 lines

- [x] **T02: Create API client module**
  - Create `web/src/api/client.ts` typed fetch wrappers
  - Cover: tasks CRUD, agents, projects, settings, events
  - Files: `web/src/api/client.ts`
  - Effort: ~150 lines

- [x] **T03: Create WebSocket hook**
  - Create `web/src/hooks/useWebSocket.ts`
  - Auto-reconnect, subscribe/unsubscribe taskId
  - Dispatch Zustand store on message
  - Files: `web/src/hooks/useWebSocket.ts`
  - Effort: ~100 lines

- [x] **T04: Port and adapt Zustand stores**
  - Port `poc/layout/src/stores/kanbanStore.ts` → `web/src/stores/kanbanStore.ts`
  - Port `poc/layout/src/stores/agentStore.ts` → `web/src/stores/agentStore.ts`
  - Replace mock data with API calls (T02)
  - Wire WebSocket updates (T03)
  - Files: `web/src/stores/kanbanStore.ts`
  - Effort: ~200 lines

## Phase 2: Core UI Components

- [x] **T05: Port KanbanBoard component**
  - Port `poc/layout/src/components/kanban/KanbanBoard.tsx` → `web/src/components/kanban/KanbanBoard.tsx`
  - @dnd-kit drag & drop, Zustand integration
  - Columns: Inbox, Manager, Produto+Generic, Architecture+Engineer, Code Review+QA, Done
  - Files: `web/src/components/kanban/KanbanBoard.tsx`
  - Effort: ~250 lines

- [x] **T06: Port CreateTaskDialog**
  - Port `poc/layout/src/components/kanban/CreateTaskDialog.tsx` → `web/src/components/kanban/CreateTaskDialog.tsx`
  - Form: title, agent, model, effort
  - POST via API client (T02)
  - Files: `web/src/components/kanban/CreateTaskDialog.tsx`
  - Effort: ~150 lines

- [x] **T07: Port TaskDrawer**
  - Port `poc/layout/src/components/kanban/TaskDrawer.tsx` → `web/src/components/kanban/TaskDrawer.tsx`
  - Tabs: Chat, Workflow, History, Summary
  - Chat shows API-fetched messages, inline title editing, color picker
  - Files: `web/src/components/kanban/TaskDrawer.tsx`, `web/src/components/kanban/TaskChatPanel.tsx`, `web/src/components/kanban/TaskHistoryPanel.tsx`, `web/src/components/kanban/TaskSummaryPanel.tsx`
  - Effort: ~300 lines

- [x] **T08: Create Utility components**
  - Create loading spinner, error boundary, empty state
  - Files: `web/src/components/ui/loading.tsx`, `web/src/components/ui/error-boundary.tsx`, `web/src/components/ui/empty-state.tsx`
  - Effort: ~100 lines

## Phase 3: Backend Gaps

- [x] **T09: Add missing agents to orquestrator-factory**
  - Added Architecture, CodeReviewer, QA agents to `src/cli/orquestrator-factory.ts`
  - Created `src/infrastructure/agents/index.ts` with enriched AgentDefinition (name, role, skills, promptTemplate, runtimeConfig, tools)
  - Files: `src/cli/orquestrator-factory.ts`, `src/infrastructure/agents/index.ts`
  - Effort: ~80 lines (actual: 130 lines)

- [x] **T10: Create ProjectFileStore**
  - Created `src/infrastructure/persistence/project-file-store.ts`
  - CRUD: createProject, getProject, updateProject, deleteProject, listProjects
  - Database-as-filesystem: each project stored as `.kanban-data/projects/{id}.json`
  - Uses PathSandbox + AtomicWriter for safe I/O
  - Files: `src/infrastructure/persistence/project-file-store.ts`
  - Effort: ~150 lines (actual: 165 lines)

- [x] **T11: Report endpoints**
  - Created `src/infrastructure/api/routes/reports.ts`
  - GET /api/report/summary returns task counts + token/cost metrics
  - GET /api/report/graph returns nodes + edges for workflow graph
  - Registered in `src/infrastructure/api/http-server.ts`
  - Files: `src/infrastructure/api/routes/reports.ts`, `src/infrastructure/api/http-server.ts`
  - Effort: ~120 lines (actual: 110 lines)

- [x] **T12: Chat history endpoint**
  - Added GET /api/tasks/:taskId/chat to `src/infrastructure/api/routes/tasks.ts`
  - Returns parsed chat array from TaskFileStore (JSONL)
  - Files: `src/infrastructure/api/routes/tasks.ts`
  - Effort: ~50 lines (actual: 20 lines)

## Phase 4: Integration

- [x] **T13: Setup main App layout routing**
  - Created `web/src/router.tsx` with routes: /, /projects, /projects/:id, /settings
  - Navbar (top nav) serves navigation — nav items: Kanban, Projects, Settings
  - App.tsx uses Outlet nested route rendering
  - Files: `web/src/router.tsx`, `web/src/components/layout/Navbar.tsx`, `web/src/App.tsx`
  - Effort: ~150 lines (actual: ~80 lines)

- [x] **T14: Wire server.ts to serve web/dist**
  - http-server.ts already registered fastify-static for web/dist
  - Added SPA fallback via setNotFoundHandler: serves index.html for non-API routes, 404 for /api/*
  - Files: `src/infrastructure/api/http-server.ts`
  - Effort: ~30 lines (actual: ~10 lines)

- [x] **T15: Port Settings page**
  - Ported all settings subcomponents: SettingsLayout, AppearanceSettings, ProvidersSettings, AdvancedSettings
  - Wired to GET/PATCH /api/settings via settingsStore → api client
  - Files: `web/src/components/settings/SettingsLayout.tsx`, `web/src/components/settings/AppearanceSettings.tsx`, `web/src/components/settings/ProvidersSettings.tsx`, `web/src/components/settings/AdvancedSettings.tsx`
  - Effort: ~120 lines

- [x] **T16: Port Projects page**
  - Ported ProjectsGrid, ProjectDetail, ProjectCard, ProjectDialog from POC
  - ProjectsGrid: fetch + CRUD via projectsStore -> api client
  - ProjectDetail: real data from store + status badges for associated tasks
  - Files: `web/src/components/projects/ProjectsGrid.tsx`, `web/src/components/projects/ProjectDetail.tsx`, `web/src/components/projects/ProjectCard.tsx`, `web/src/components/projects/ProjectDialog.tsx`
  - Effort: ~150 lines

- [x] **T17: shadcn/ui component setup**
  - Add remaining shadcn/ui components if missing
  - Files: `web/src/components/ui/`
  - Effort: ~50 lines

- [x] **T18: Build scripts**
  - Add `"build:web": "cd web && npm run build"` to root package.json
  - Add `"build": "npm run build:web && npm run build:src"` combined script
  - Files: `package.json`
  - Effort: ~10 lines

- [x] **T19: Integration smoke test**
  - Start server: `swarm server`
  - Verify Kanban loads, create task, see it appear
  - Verify WebSocket updates in real time
  - Verify task drawer shows chat
  - Effort: 0 lines (manual validation)

## Review Workload

| Task | Estimated Lines Changed |
|------|------------------------|
| T01: web/ scaffold | ~120 |
| T02: API client | ~150 |
| T03: WebSocket hook | ~100 |
| T04: Zustand stores | ~200 |
| T05: KanbanBoard | ~250 |
| T06: CreateTaskDialog | ~150 |
| T07: TaskDrawer | ~300 |
| T08: Utility components | ~100 |
| T09: Missing agents | ~80 |
| T10: ProjectFileStore | ~150 |
| T11: Report endpoints | ~120 |
| T12: Chat endpoint | ~50 |
| T13: App layout/routing | ~150 |
| T14: Server static serving | ~30 |
| T15: Settings page | ~120 |
| T16: Projects page | ~150 |
| T17: shadcn/ui setup | ~50 |
| T18: Build scripts | ~10 |
| T19: Smoke test | 0 |
| **TOTAL** | **~2,280** |

**No single task exceeds 800 lines.** Largest task T07 (TaskDrawer) at ~300 lines.

**Critical path:** T01 → T02 → T03 → T04 → T05 → T06 → T07 → T13 → T14 → T19

**Parallelizable:**
- T09, T10, T11, T12 (backend) can run in parallel with T05-T08 (frontend)
- T15, T16 can run after T13
- T17 can run anytime after T01
