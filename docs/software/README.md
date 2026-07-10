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
- **AgentClient** (`agent-client.ts`): Interface consumida por Orquestrator/Supervisor (`run`, `buildRunConfig`, `repairInvalidOutput`, `generateTitle`), extraída do `PiAgentClient` para plugar um segundo agent sem tocar os chamadores
- **PiClient**: Adaptador para Pi SDK, implementa `AgentClient` via `AgentRunner`
- **CodexClient** (`codex-client.ts`): Implementa `AgentClient` falando com `codex app-server`; reusa a montagem de prompts do Pi e usa `outputSchema` para decisão estruturada nativa
- **RoutingAgentClient** (`orquestrator-factory.ts`): Seleciona Pi ou Codex por `runtimeConfig.agent` (resolvido), instanciando cada client de forma lazy
- **WorkerSupervisor**: Executa runs em `inproc` ou worker UDS em container via `docker run`; monta `buildDockerRunArgs`, traduz paths host↔container e injeta segredos por `--env-file`
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
- **pi-runner.ts**: `PiSdkAgentRunner` — executa o Pi SDK
- **codex-runner.ts**: Cliente JSON-RPC 2.0/stdio do `codex app-server` (handshake `initialize/initialized` → `thread/start` → `turn/start`; um processo por chamada); expõe `runCodexTurn` e `DECISION_OUTPUT_SCHEMA`
- **orquestrator-factory.ts**: Wiring; monta o `RoutingAgentClient` e o `WorkerSupervisor` com CODEX_HOME e keys resolvidas (settings → env)

## Agents e Isolamento (deltas de arquitetura)

Camada de agents intercambiáveis e execução containerizada:

- **AgentClient** (`src/application/agent-client.ts`): interface única para os
  dois agents; `RoutingAgentClient` roteia por `runtimeConfig.agent`.
- **codex-runner** (`src/cli/codex-runner.ts`): JSON-RPC/stdio contra `codex
  app-server`; `sandboxPolicy` = `externalSandbox` em Docker (container é o
  sandbox), `workspaceWrite` em inproc.
- **MCP bridge** (`src/worker/mcp-bridge.ts`): servidor MCP stdio hand-rolled
  (~180 linhas, sem SDK) que expõe as tools do Master ao Codex; `tools/list` →
  `GET /tools` e `tools/call` → `POST /tool` no UDS de tool-callback
  (`KCA_TOOLS_SOCKET`). Registrado no `config.toml` do CODEX_HOME.
- **codex-home** (`src/infrastructure/security/codex-home.ts`): garante o
  CODEX_HOME compartilhado (0700) e regenera o `config.toml` do bridge
  idempotentemente; nunca toca o `auth.json`.
- **Worker executor** (`src/worker/executor.ts`): out-of-process, escolhe o
  runner (Pi ou Codex) pelo campo `agent` do payload `POST /run`, sem
  Orquestrator — só o config serializado. Tools chegam como proxies via UDS.
- **Docker no supervisor** (`src/infrastructure/process/worker-supervisor.ts`):
  `buildDockerRunArgs` (`--rm --init`, mounts `/kca/data|app|bin`, limites
  mem/cpu, `--env-file` p/ segredos), `toContainer` traduz paths, cancel via
  `docker stop`. Constantes `CONTAINER_DATA_DIR=/kca/data`,
  `CONTAINER_APP_DIR=/kca/app`, `CONTAINER_BUNDLE_DIR=/kca/bin`.
- **Devcontainer** (`src/infrastructure/containers/devcontainer.ts`):
  `devcontainer build` via `@devcontainers/cli`, cache por hash, tag
  `kca-devc-<slug>-<hash>`; `dockerComposeFile` = erro, `runArgs` = ignorado.
- **Worker bundle** (`scripts/build-worker-bundle.mjs`, `pnpm build:worker`):
  esbuild single-file de `worker.mjs` + `mcp-bridge.mjs` em `dist-worker/`,
  montável read-only em qualquer imagem glibc.
- **Settings persistente** (`src/infrastructure/persistence/settings-store.ts`):
  `.swarm/settings.json` (0600) — agent default + provider keys (mascaradas na
  leitura), fonte de runtime com fallback para envvar.

> systemd foi **removido** nesta iteração; `SWARM_ISOLATION` aceita apenas
> `inproc` (default) e `docker`.

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

### Data Root

A persistência do swarm vive fora do projeto, no diretório do usuário:

```
~/.kca/                          ← dataDir (configurável via SWARM_DATA_DIR)
  └── .swarm/                    ← subdiretório do swarm
      ├── events/
      │   └── current.jsonl      ← event log append-only (SSOT)
      ├── tasks/
      │   ├── {taskId}/
      │   │   ├── chat.jsonl     ← log de chat da task
      │   │   ├── artifacts/     ← artefatos gerados pelo agente
      │   │   ├── attachments/   ← anexos do humano
      │   │   └── workspace/     ← cwd isolado da execução
      │   └── _archived/         ← tasks arquivadas
      ├── projects/
      │   └── {slug}/
      │       ├── project.json   ← slug/gitUrl/defaultBranch/autoMerge
      │       └── repo.git/      ← mirror Git compartilhado pelos worktrees
      └── state.snapshot.json    ← snapshot do estado
```

- **`dataDir`** (default `~/.kca`): raiz de toda persistência. Override com `SWARM_DATA_DIR` envvar ou `data_dir` em `swarm.yml`.
- **`.swarm/`**: subdiretório fixo para dados do swarm (eventos, tasks, snapshot).
- Projetos ficam em `.swarm/projects/<slug>/project.json` e também são reconstruíveis por eventos `PROJECT_*`.
- Tasks vinculadas a projeto usam worktree em `.swarm/tasks/<taskId>/workspace/<slug>/`; o branch padrão só é escrito pelo Master.

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
