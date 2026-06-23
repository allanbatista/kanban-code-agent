# Lote 3: Backend Gaps (T09–T12)

Date: 2026-06-16

## Changed

- Added Architecture, Code Reviewer, QA agents to orquestrator-factory + enriched agent definitions in `src/infrastructure/agents/`
- Created ProjectFileStore (filesystem-backed CRUD for projects)
- Created report endpoints (execution summary + workflow graph)
- Added chat history endpoint (GET /api/tasks/:taskId/chat)

## Files

- `src/infrastructure/agents/index.ts`: AgentDefinition interface + all 7 agents with name, role, skills, promptTemplate, runtimeConfig, tools
- `src/cli/orquestrator-factory.ts`: Added Architecture, Code Reviewer, QA to createAgents()
- `src/infrastructure/persistence/project-file-store.ts`: Database-as-filesystem project store (`.kanban-data/projects/{id}.json`)
- `src/infrastructure/api/routes/reports.ts`: GET /api/report/summary, GET /api/report/graph
- `src/infrastructure/api/http-server.ts`: Register report routes
- `src/infrastructure/api/routes/tasks.ts`: Added GET /api/tasks/:taskId/chat
- `src/__tests__/infrastructure/agents.test.ts` (new)
- `src/__tests__/infrastructure/project-file-store.test.ts` (new)
- `src/__tests__/infrastructure/reports.test.ts` (new)
- `src/__tests__/infrastructure/chat-history.test.ts` (new)
- `.sdd/poc-to-production-integration/tasks.md`: Mark T09-T12 complete
- `.sdd/poc-to-production-integration/tdd-evidence.md`: Append Lote 3 evidence

## Validation

- `vitest run` — 19 files, 303 tests, 0 failures
- `npx tsc --noEmit` — no new errors (pre-existing error in scheduler.test.ts unchanged)
