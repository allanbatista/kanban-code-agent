# Versão Integrada de Produção

Date: 2026-06-16

## Changed

- Arquitetura refatorada da PoC (`poc/index.ts` 2319 linhas monolíticas) para 3 camadas limpas: domain, application, infrastructure, cli
- Domain: 7 arquivos com tipos puros, Task, Agent, Run, SwarmEvent, WaitGroup, IDs criptográficos
- Application: 8 arquivos com Orquestrator (inversão de dependência), Scheduler indexado, WorkerPool, PiClient, PromptBuilder (idempotente), DecisionParser (estrito), BudgetTracker
- Infrastructure: 13 arquivos com EventStore (append-only JSONL), SnapshotStore (atômico), TaskFileStore, PathSandbox, AtomicWriter, Logger (JSON), AuditTrail, Config (envvar > arquivo > default)
- API: Fastify HTTP + WebSocket + SSE com Zod validation, 16 rotas REST (tasks, agents, projects, settings, events)
- CLI: 4 arquivos com modos server (API + UI) e runner (single task), parse de argumentos, graceful shutdown
- Frontend: `poc/layout/` movido para `web/`, integrado com API real (HTTP + WebSocket), Zustand stores consumindo backend, zero mocks

## Files

- `src/domain/*.ts` (7): Tipos puros de domínio extraídos da PoC
- `src/application/*.ts` (8): Orquestrador, scheduler, worker pool, Pi client, prompt builder, decision parser, budget tracker
- `src/infrastructure/persistence/*.ts` (3): Event store, snapshot store, task file store
- `src/infrastructure/filesystem/*.ts` (2): Path sandbox, atomic writer
- `src/infrastructure/logging/*.ts` (2): Logger estruturado, audit trail
- `src/infrastructure/api/*.ts` (9): HTTP server, WS server, 5 rotas, 2 middlewares
- `src/infrastructure/config.ts`: Configuração envvar/arquivo/defaults
- `src/cli/*.ts` (5): Main, server, runner, orquestrator factory, Pi runner
- `web/src/api/*.ts` (3): HTTP client, WS client, adapter
- `web/src/stores/*.ts` (3): Kanban, projects, settings stores (API real)
- `web/src/types/api.ts`: Tipos do contrato da API
- `docs/usage/README.md`: Guia de uso completo
- `docs/software/README.md`: Documentação de software (arquitetura, decisões)
- `.features/20260616-1423-verso-integrada-producao/plan.md`: Plano de execução com progresso

## Validation

- `pnpm build` — limpo
- `pnpm test` — 284 testes passando (15 arquivos)
- `pnpm lint` — sem erros
- `cd web && pnpm run build` — build do frontend OK
