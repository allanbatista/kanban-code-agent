# API Layer (Phase 3) - REST + WebSocket Server

Date: 2026-06-16

## Changed

- Fastify HTTP server with CORS, WebSocket, static file serving
- REST CRUD routes: tasks, agents, projects, settings
- SSE event stream for swarm events
- WebSocket server for real-time event broadcast
- Zod validation on all request inputs
- Error handler middleware (ZodError → 400, AgentOutputInvalid → 422, generic → 500)
- Request logger middleware
- Health check endpoint (GET /health)
- Orquestrator `events` field changed from private to public for API access

## Files

- `src/infrastructure/api/http-server.ts`: Fastify server factory with all plugins, middleware, health check
- `src/infrastructure/api/routes/tasks.ts`: CRUD routes (GET/POST/PATCH/DELETE /api/tasks) with Zod validation
- `src/infrastructure/api/routes/agents.ts`: Agent list, detail, update routes (GET/PATCH /api/agents)
- `src/infrastructure/api/routes/projects.ts`: Project CRUD (in-memory store) with Zod validation
- `src/infrastructure/api/routes/settings.ts`: Settings read/update (appearance, providers, advanced)
- `src/infrastructure/api/routes/events.ts`: SSE streams for all events and per-task events
- `src/infrastructure/api/ws-server.ts`: WebSocket server with subscribe/filter/broadcast
- `src/infrastructure/api/middleware/error-handler.ts`: ZodError, AgentOutputInvalid, generic error handling
- `src/infrastructure/api/middleware/request-logger.ts`: Structured JSON request logging
- `src/infrastructure/index.ts`: Added API barrel exports
- `src/application/orquestrator.ts`: Changed `events` from `private` to `public` for API access

## Validation

- `npx tsc --noEmit`: zero errors from API code
- `npx vitest run`: all 48 orquestrator tests run, 13 pre-existing failures unchanged (0 new failures)
- `graphify update`: graph rebuilt successfully (2226 nodes, 3734 edges)
