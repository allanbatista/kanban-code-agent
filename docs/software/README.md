# Kanban Code Agent — Documentação de Software

## Visão Geral

Sistema de orquestração multi-agent com arquitetura event-driven em 3 camadas.

## Arquitetura

```
┌─────────────────────────────────────────┐
│              CLI (entry point)           │
│  main.ts → server.ts | runner.ts        │
├─────────────────────────────────────────┤
│           API (HTTP + WebSocket)         │
│  Fastify + Zod + SSE + WS               │
├─────────────────────────────────────────┤
│         Application (use cases)          │
│  Orquestrator, Scheduler, WorkerPool     │
│  PiClient, PromptBuilder, DecisionParser │
│  BudgetTracker                           │
├─────────────────────────────────────────┤
│          Infrastructure (adapters)        │
│  EventStore, SnapshotStore, TaskFileStore │
│  PathSandbox, AtomicWriter               │
│  Logger, AuditTrail, Config              │
├─────────────────────────────────────────┤
│            Domain (pure types)            │
│  Task, Agent, Run, SwarmEvent, WaitGroup │
│  IDs, Types                              │
└─────────────────────────────────────────┘
```

## Camadas

### Domain (`src/domain/`)

Entidades puras, value objects e eventos de domínio. Sem dependências externas.

- **Task**: Entidade central com status, chat, runs, subtasks, artefatos
- **Agent**: Configuração de agent com nome, role, runtimeConfig
- **SwarmEvent**: Evento imutável do event log
- **WaitGroup**: Grupo de espera com modos WAIT_ALL e ON_DEMAND
- **IDs**: Sequenciais com prefixo (task_1, run_1, evt_1), gerados pelo Orquestrator e derivados do estado persistido na recuperação

### Application (`src/application/`)

Casos de uso e orquestração. Depende apenas de domain e interfaces de infrastructure.

- **Orquestrator**: Core da orquestração com inversão de dependência. Recebe stores via constructor
- **Scheduler**: Agenda tasks baseado em dependências (índice waitingByDependency)
- **WorkerPool**: Pool de workers com controle de concorrência, timeout e cancel
- **PiClient**: Adaptador para Pi SDK com AgentRunner interface
- **PromptBuilder**: Função pura para construção de prompts (idempotente)
- **DecisionParser**: Parser estrito de JSON do agent (AgentOutputInvalidError)
- **BudgetTracker**: Rastreio de tokens e custo por task

### Infrastructure (`src/infrastructure/`)

Adaptadores concretos para persistência, filesystem, rede e logging.

- **EventStore**: Append-only JSONL (`.swarm/events/current.jsonl`)
- **SnapshotStore**: Snapshot atômico com backup (`.swarm/state.snapshot.json`)
- **TaskFileStore**: Arquivos por task (YAML, JSONL, anexos)
- **PathSandbox**: Validação rígida de paths (rejeita traversal, absolutos, symlinks, NUL)
- **AtomicWriter**: Escrita atômica via write+rename
- **Logger**: Logger estruturado JSON (níveis trace→fatal)
- **AuditTrail**: Trilha de auditoria append-only
- **Config**: Gerenciamento de configuração (envvar > arquivo > default)
- **API**: Fastify HTTP + WebSocket + SSE com Zod validation

### CLI (`src/cli/`)

Entry points da aplicação.

- **main.ts**: Parse de argumentos e roteamento
- **server.ts**: Modo servidor (API + UI estática)
- **runner.ts**: Modo runner (task única)

## Fluxo de Eventos

```
TASK_CREATED → TASK_QUEUED → TASK_STARTED → RUN_STARTED
                                              ↓
                                    ┌─ completed → RUN_COMPLETED → TASK_COMPLETED
                                    ├─ waiting   → TASK_WAITING → WAIT_GROUP_READY → TASK_RESUMED
                                    └─ retry     → TASK_RETRY_REQUESTED → TASK_RETRIED → (re-queue)
```

## Decisões de Design

### Event Sourcing

O event log (`current.jsonl`) é a fonte da verdade. Snapshots são projeções reconstruíveis. Cada evento é imutável e append-only.

### Inversão de Dependência

O Orquestrator recebe suas dependências (EventStore, SnapshotStore, TaskFileStore, Sandbox) via constructor. Isso permite testes com stores reais em tmpdir sem acoplamento a paths fixos.

### Segurança de Filesystem

PathSandbox valida todos os paths antes de qualquer operação de I/O. Rejeita path traversal (`../`), paths absolutos, symlinks e NUL bytes.

### Idempotência de Prompt

PromptBuilder é uma função pura: mesmo input produz mesmo output. O chat só é atualizado após o run ser confirmado (evita poluição em retry/replay).

### Configuração

Prioridade: envvar > arquivo (`swarm.yml`) > defaults. Permite override por ambiente sem modificar arquivos.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 22+ / TypeScript |
| API HTTP | Fastify + Zod |
| WebSocket | @fastify/websocket |
| Frontend | React 19 + Vite 8 + Tailwind 4 + shadcn/ui |
| Estado | Zustand |
| Testes | Vitest |
| Logging | Pino (JSON estruturado) |

## Convenções

- Código: en-US
- Documentação e comentários: pt-BR
- Arquivos: kebab-case
- Classes: PascalCase
- Variáveis/funções: camelCase
- Constantes: UPPER_SNAKE_CASE
- Exportações: nomeadas (sem default exports)

## Testes

```bash
pnpm test          # Todos os testes (284 testes, 15 arquivos)
pnpm test:watch    # Modo watch
pnpm lint          # ESLint
pnpm typecheck     # Verificação de tipos
pnpm build         # Build completo
```
