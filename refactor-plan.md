# Refactor Plan: Modular Architecture for Kanban Code Agent

Date: 2026-06-12
Status: draft
Scope: architecture refactor, no product behavior change by default

## Goal

Make the project more robust and scalable by separating storage, domain rules, application use cases, orchestration, read models, and transport.

The target is to reduce coupling around `@kca/fsdb` and `@kca/orchestrator`, make commands and queries easier to extend, and create clear ownership for future features such as alternative storage, richer agents, external events, and cached board projections.

## Current Problems

| Problem | Current Evidence | Impact |
|---|---|---|
| FSDB mixes storage and domain behavior | `packages/fsdb/src/index.js` creates tasks, defaults domain fields, writes artifacts, emits events, and builds board snapshots | Hard to replace filesystem storage or test domain behavior without real files |
| Orchestrator is a god module | `packages/orchestrator/src/index.js` handles commands, queries, hooks, task mutation, scheduling, chat, agents, deployment, review, and read models | High risk when adding commands, difficult isolated tests |
| Query/read model is coupled to orchestrator | `/api/state` goes through `handleQuery({ type: "board.snapshot" })` | UI refresh appears as orchestrator work and couples reads to workflow engine |
| Direct dependencies bypass boundaries | Orchestrator imports many FSDB functions directly | No clear contract between application logic and persistence |
| Command dispatch is procedural | Large `if (command.type === "...")` chain | New commands require editing central file, violating OCP |
| Policies are embedded in use cases | `whyNotRunning` mixes dependency, lock, WIP, provider, agent, and project-capacity rules | Hard to change one policy safely |
| Event-driven behavior is partial | Scheduler is event-driven, but read model/polling still causes repeated snapshots | More logs and filesystem reads than needed |

## Design Principles

| Principle | Application |
|---|---|
| SRP | One module owns one reason to change |
| OCP | Add commands, policies, storage adapters, and providers without editing central orchestration code |
| LSP | Storage implementations must be swappable through repository ports |
| ISP | Services depend on narrow interfaces, not all of FSDB |
| DIP | Application and domain depend on ports; infrastructure implements ports |
| CQRS | Commands mutate state; queries read optimized read models |
| Hexagonal Architecture | Domain/application core is independent from HTTP, filesystem, agents, and git |
| Event Driven | Domain events trigger scheduler, projections, broadcasts, and external side effects |

## Target Architecture

```text
apps/daemon
  -> HTTP/SSE/WS controllers
  -> command/query adapters
  -> application services
  -> domain services and policies
  -> ports
  -> infrastructure adapters

packages/domain
  -> entities, value objects, events, pure policies

packages/application
  -> use cases, command handlers, query handlers, event handlers

packages/ports
  -> repository and adapter interfaces

packages/fsdb-adapter
  -> filesystem implementation of ports

packages/orchestrator
  -> workflow engine, agent lifecycle, scheduler, gates

packages/board-service
  -> board read model, snapshot, status, projections

packages/task-service
  -> task mutations and invariants
```

## Proposed Module Boundaries

### Domain

Owns pure business concepts.

Files to create or evolve:

| Module | Responsibility |
|---|---|
| `packages/domain/src/entities/task.js` | Task entity behavior and invariants |
| `packages/domain/src/entities/board.js` | Board and column model |
| `packages/domain/src/value-objects/task-id.js` | Task id validation/generation rules |
| `packages/domain/src/value-objects/column-id.js` | Column normalization and validation |
| `packages/domain/src/value-objects/role-id.js` | Role/persona ids |
| `packages/domain/src/events/task-events.js` | Domain event definitions |
| `packages/domain/src/policies/task-transition-policy.js` | Legal task transitions |
| `packages/domain/src/policies/task-runnability-policy.js` | Pure runnable checks |

Domain must not import:

- `node:fs`
- `@kca/fsdb`
- `@kca/pi-adapter`
- `@kca/git-worktree`
- HTTP/server modules

### Ports

Defines interfaces consumed by application services.

| Port | Methods |
|---|---|
| `TaskRepository` | `findById`, `list`, `save`, `exists` |
| `TaskArtifactRepository` | `readFile`, `writeFile`, `listFiles` |
| `BoardRepository` | `getDefaultBoard`, `saveBoard` |
| `SettingsRepository` | `readScope`, `updateScope`, `readAll` |
| `EventStore` | `appendTaskEvent`, `appendRuntimeEvent`, `listTaskEvents`, `listRuntimeEvents` |
| `CommandResultStore` | `get`, `put` |
| `SemaphoreRepository` | `readState`, `acquire`, `release` |
| `AgentRuntimePort` | `startRun`, `interruptRun`, `writeRunSummary`, `buildChat` |
| `WorktreePort` | `createWorktree`, `mergeSubtask` |
| `DeploymentPort` | `runDeployment` |
| `Clock` | `now` |
| `IdGenerator` | `taskId`, `commandId`, `runId` |

### Infrastructure Adapters

`fsdb` becomes an adapter, not the domain owner.

| Adapter | Implements |
|---|---|
| `FsdbTaskRepository` | `TaskRepository` |
| `FsdbTaskArtifactRepository` | `TaskArtifactRepository` |
| `FsdbBoardRepository` | `BoardRepository` |
| `FsdbSettingsRepository` | `SettingsRepository` |
| `FsdbEventStore` | `EventStore` |
| `FsdbCommandResultStore` | `CommandResultStore` |
| `FsdbSemaphoreRepository` | `SemaphoreRepository` |

Low-level filesystem helpers remain in FSDB:

- paths
- atomic write
- YAML/JSONL read/write
- directory layout
- migrations/recovery

Domain defaults should move out of FSDB:

- task default status
- default routing
- default worktree
- default dependencies
- planning artifact structure

### TaskService

Application service for basic task mutations.

Responsibilities:

- create task
- update task
- move task
- write task file
- answer input
- block/unblock task
- route task to role
- append domain events
- enforce basic task invariants

Should not:

- start agent runs
- decide full scheduler behavior
- build board snapshots
- know filesystem paths

### BoardService

Read model service for the board.

Responsibilities:

- `snapshot()`
- `taskDetail(taskId)`
- `taskFiles(taskId)`
- `orchestratorStatus()`
- `chatHistory(query)`
- projection/cache invalidation

The daemon should call `BoardService.snapshot()` for `/api/state`.

The orchestrator should not own `board.snapshot`.

### OrchestratorService

Workflow service for agent-driven execution.

Responsibilities:

- run task
- complete task
- interrupt task
- wait for persona
- wait for human
- delegate task
- review gate
- deploy gate
- merge task
- invoke hooks

Should depend on:

- `TaskService`
- `SchedulerService`
- `AgentRuntimePort`
- `WorktreePort`
- `DeploymentPort`
- `EventBus`

Should not depend directly on:

- `FsdbTaskRepository`
- filesystem paths
- HTTP transport
- board snapshot read model

### SchedulerService

Queue and capacity service.

Responsibilities:

- drain queue on events
- find runnable queued tasks
- evaluate runnability policies
- acquire/release semaphore leases
- start runnable task through orchestrator
- produce scheduler events

Should use:

- `TaskRepository`
- `SettingsRepository`
- `SemaphoreRepository`
- `RunnabilityService`
- `OrchestratorService` or a narrower `TaskRunnerPort`

### EventBus

Internal pub/sub for domain and integration events.

Initial implementation can be in-memory and synchronous.

Later implementation can persist events or use queues.

Example events:

| Event | Consumers |
|---|---|
| `TaskCreated` | BoardProjection |
| `TaskMoved` | SchedulerService, BoardProjection |
| `TaskQueued` | SchedulerService, BoardProjection |
| `TaskStarted` | BoardProjection |
| `TaskCompleted` | SchedulerService, BoardProjection |
| `TaskBlocked` | SchedulerService, BoardProjection |
| `TaskUnblocked` | SchedulerService, BoardProjection |
| `PersonaHandoffRequested` | SchedulerService, BoardProjection |
| `SettingsChanged` | SchedulerService, BoardProjection |
| `ExternalFsdbChanged` | BoardProjection |
| `SchedulerTickCompleted` | Daemon broadcaster |

## Design Patterns

| Pattern | Use |
|---|---|
| Repository | Abstract persistence for tasks, settings, board, semaphores, events |
| Ports and Adapters | Keep domain/application independent from filesystem, HTTP, git, agents |
| CQRS | Separate command mutations from read model queries |
| Command | One command handler per command type |
| Strategy | Provider, routing, merge, deployment, and role policies |
| Specification | Compose runnability checks |
| State | Legal task transitions |
| Observer | EventBus consumers for scheduler/projections/broadcasts |
| Decorator | Idempotency, logging, validation, metrics around handlers |
| Factory | Task, subtask, run, and event creation |
| Unit of Work | Optional later for grouped FSDB writes |

## Command Bus Design

Current state:

```text
handleCommand(input)
  parse
  check idempotency
  if command.type === ...
  record result
```

Target:

```text
CommandBus.execute(input)
  parse command
  resolve handler from registry
  apply decorators
  handler.handle(command)
```

Handler registry:

```text
task.create -> CreateTaskHandler
task.move -> MoveTaskHandler
task.run -> RunTaskHandler
agent.complete_task -> CompleteTaskHandler
scheduler.tick -> DrainSchedulerHandler
settings.update -> UpdateSettingsHandler
```

Decorators:

| Decorator | Responsibility |
|---|---|
| `ValidationCommandHandler` | Parse schemas |
| `IdempotentCommandHandler` | Read/write command result store |
| `LoggingCommandHandler` | Standard logs |
| `EventPublishingCommandHandler` | Publish returned domain events |
| `SchedulerDrainCommandHandler` | Drain scheduler for relevant events |

## Query Bus Design

Queries should not flow through the orchestrator unless they query orchestration state.

Target query routing:

| Query | Service |
|---|---|
| `board.snapshot` | `BoardService` |
| `task.detail` | `BoardService` or `TaskReadService` |
| `task.files` | `BoardService` |
| `chat.history` | `ChatService` |
| `settings.scope` | `SettingsService` |
| `provider.discover` | `ProviderService` |
| `orchestrator.status` | `OrchestratorReadService` or `BoardService` with runtime ports |
| `why_not_running` | `RunnabilityService` |

## Runnability Policy Design

Current `whyNotRunning` should become a policy pipeline.

Specifications:

| Specification | Checks |
|---|---|
| `StatusRunnableSpec` | idle, queued, validating, running semantics |
| `DependenciesSatisfiedSpec` | all `needs` have provided contracts |
| `FileLocksAvailableSpec` | no running task owns same file locks |
| `GlobalCapacityAvailableSpec` | max parallel tasks |
| `AgentCapacityAvailableSpec` | agent token limits |
| `ProjectCapacityAvailableSpec` | project token limits |
| `ColumnWipAvailableSpec` | WIP limits |
| `SemaphoreAvailableSpec` | named semaphore conflicts |
| `ProviderConfiguredSpec` | provider env readiness |

`RunnabilityService.explain(taskId)` returns:

```json
{
  "taskId": "KCA-123",
  "runnable": false,
  "reasons": [
    {
      "code": "missing_contract",
      "message": "Aguardando contratos: contract:fsdb",
      "data": { "contracts": ["contract:fsdb"] }
    }
  ]
}
```

Benefits:

- machine-readable blockers
- easier UI grouping
- easier tests
- each policy is independently testable

## Domain Entity Sketch

```ts
class Task {
  constructor(props) {
    this.props = props;
  }

  moveTo(column, now) {
    return {
      task: new Task({ ...this.props, column, updatedAt: now }),
      events: [{ type: "TaskMoved", taskId: this.id, toColumn: column }]
    };
  }

  queueFor(role, now) {
    return {
      task: new Task({ ...this.props, status: "queued", routing: { ...this.props.routing, currentRole: role }, updatedAt: now }),
      events: [{ type: "TaskQueued", taskId: this.id, role }]
    };
  }
}
```

Use classes where identity and invariants matter. Keep pure functions for simple transformations.

## Composition Root

The daemon should compose dependencies once.

```text
createApp({ root })
  fsdbStore
  repositories
  eventBus
  taskService
  boardService
  schedulerService
  orchestratorService
  commandBus
  queryBus
  httpServer
```

This avoids importing concrete FSDB functions inside the orchestrator.

## Migration Plan

### Phase 0: Safety Net

Goal: lock current behavior before structural changes.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Add contract tests for `/api/state` | `tests/e2e/kanban.spec.js` | State schema unchanged |
| Add command result idempotency tests around moved handlers | `tests/unit/orchestrator.test.js` | Existing command ids remain idempotent |
| Add event-driven scheduler regression tests | `tests/unit/scheduler.test.js` | Queue drains after relevant events |
| Snapshot current public command/query schema | `packages/schemas/src/index.js` | No schema regression |

Definition of done:

- Unit and E2E pass.
- Public command/query names unchanged.
- No behavior refactor yet.

### Phase 1: Extract BoardService

Goal: remove board snapshot ownership from orchestrator.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create `BoardService.snapshot()` wrapping current FSDB `boardSnapshot` | `packages/board-service/src/index.js` | Unit test calls service directly |
| Change daemon `/api/state` to use `BoardService` | `apps/daemon/src/server.js` | E2E `/api/state` passes |
| Route `board.snapshot` query through `BoardService` temporarily | `packages/orchestrator/src/index.js` or query layer | Backward compatibility |
| Deprecate direct orchestrator ownership of `board.snapshot` logs | docs/changelog | Logs show board service scope |

Definition of done:

- `/api/state` no longer calls `handleQuery({ type: "board.snapshot" })`.
- Existing UI behavior unchanged.
- `board.snapshot` query remains compatible.

### Phase 2: Extract TaskService

Goal: move basic task mutation use cases out of orchestrator and FSDB.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create `TaskService.createTask` | `packages/task-service/src/index.js` | Unit test with FSDB adapter |
| Create `TaskService.moveTask` | `packages/task-service/src/index.js` | AutoStart behavior preserved |
| Create `TaskService.updateTask` | `packages/task-service/src/index.js` | Existing update tests pass |
| Move file write use case to TaskService | `packages/task-service/src/index.js` | Task modal file tests pass |
| Keep FSDB functions as adapter-compatible wrappers | `packages/fsdb/src/index.js` | No immediate CLI break |

Definition of done:

- Orchestrator uses `TaskService` for task CRUD.
- FSDB still provides compatibility exports.
- No direct domain defaults in new FSDB code.

### Phase 3: Extract Repositories and Ports

Goal: introduce dependency inversion without replacing storage.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Add repository interfaces as documented contracts | `packages/ports/src/*.js` | Type/schema docs or JS doc |
| Implement FSDB repositories | `packages/fsdb/src/repositories/*.js` | Repository unit tests |
| Add memory repositories for tests | `packages/test-fixtures/src/memory-repositories.js` | Faster policy tests |
| Update TaskService to depend on repositories | `packages/task-service/src/index.js` | Tests pass with FSDB and memory |

Definition of done:

- Application services depend on ports.
- FSDB is one adapter.
- At least one service test uses memory repositories.

### Phase 4: Extract RunnabilityService

Goal: make scheduler policies explicit and testable.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create specifications | `packages/orchestrator/src/policies/*.js` | One test per spec |
| Create `RunnabilityService` | `packages/orchestrator/src/runnability-service.js` | Existing `why_not_running` tests pass |
| Replace `whyNotRunning` internals | `packages/orchestrator/src/index.js` | Same messages or mapped codes |
| Update scheduler to use service | `packages/orchestrator/src/scheduler.js` | Scheduler tests pass |

Definition of done:

- Each runnability rule is independently tested.
- Scheduler behavior unchanged.
- Reasons can become structured without breaking UI.

### Phase 5: Introduce CommandBus

Goal: replace central procedural command dispatch.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create CommandBus and handler registry | `packages/application/src/command-bus.js` | Registry unit test |
| Add decorators for validation, idempotency, logging | `packages/application/src/command-decorators.js` | Idempotency tests pass |
| Move handlers incrementally | `packages/application/src/handlers/*.js` | One command at a time |
| Keep `handleCommand` as facade | `packages/orchestrator/src/index.js` | Existing imports unchanged |

Definition of done:

- New commands do not edit a giant `if` block.
- `handleCommand` delegates to bus.
- Public command API unchanged.

### Phase 6: Introduce QueryBus

Goal: route reads to the right read services.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create QueryBus and handlers | `packages/application/src/query-bus.js` | Query routing tests |
| Route board queries to BoardService | `packages/board-service/src/index.js` | `/api/state` and `board.snapshot` pass |
| Route settings queries to SettingsService | `packages/application/src/settings-service.js` | Settings modal tests pass |
| Route chat queries to ChatService | `packages/application/src/chat-service.js` | Chat E2E passes |

Definition of done:

- Orchestrator no longer owns generic read models.
- Query logs identify the read service, not orchestration.

### Phase 7: EventBus and Projection

Goal: reduce polling and expensive repeated snapshots.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Create internal EventBus | `packages/application/src/event-bus.js` | Event handler tests |
| Publish domain events from services | TaskService/OrchestratorService | Events visible in runtime logs |
| Add BoardProjection cache | `packages/board-service/src/projection.js` | Snapshot reads avoid full FSDB scan in idle |
| Add FSDB external watcher event | `apps/daemon/src/server.js` or FSDB adapter | External file edits update UI |
| SSE broadcasts from events | `apps/daemon/src/server.js` | UI updates without polling |

Definition of done:

- No repeated `board.snapshot` in idle.
- UI updates after commands.
- UI updates after external FSDB file edit.

### Phase 8: OrchestratorService Split

Goal: narrow orchestrator to workflow execution.

Tasks:

| Task | Files | Evidence |
|---|---|---|
| Move hook execution to HookService | `packages/orchestrator/src/hook-service.js` | Hook tests pass |
| Move agent handoff to PersonaWorkflowService | `packages/orchestrator/src/persona-workflow-service.js` | Agentic workflow tests pass |
| Move review/deploy gates to GateService | `packages/orchestrator/src/gate-service.js` | Review/deploy tests pass |
| Move merge workflow to MergeWorkflowService | `packages/orchestrator/src/merge-workflow-service.js` | Merge tests pass |

Definition of done:

- `packages/orchestrator/src/index.js` becomes a thin facade.
- Workflow services are independently testable.

## Target Package Dependency Direction

Allowed:

```text
apps -> application -> domain
apps -> adapters
application -> ports
adapters -> ports
adapters -> infrastructure libraries
orchestrator -> application/domain/ports
```

Forbidden:

```text
domain -> fsdb
domain -> daemon
domain -> pi-adapter
application -> concrete fsdb internals
board-service -> orchestrator command handlers
daemon -> fsdb low-level functions for normal app routes
```

## Public Contracts to Preserve

Commands:

- `task.create`
- `task.update`
- `task.file.write`
- `task.move`
- `task.run`
- `task.interrupt`
- `task.decompose`
- `task.merge`
- `scheduler.tick`
- `agent.complete_task`
- `agent.report_blocker`
- `agent.request_user_input`
- `agent.emit_artifact`
- `agent.chat`
- `agent.message`
- `agent.wait_for_persona`
- `agent.wait_for_human`
- `agent.delegate_task`
- `task.answer_input`
- `role.route_task`
- `agent.review_task`
- `agent.deploy_task`
- `settings.update`

Queries:

- `board.snapshot`
- `task.detail`
- `task.files`
- `chat.history`
- `chat.build`
- `settings.scope`
- `provider.discover`
- `orchestrator.status`
- `why_not_running`

HTTP:

- `GET /health`
- `GET /api/state`
- `POST /api/query`
- `POST /api/command`
- `GET /api/events`
- `POST /api/task.move`
- `POST /api/settings.update`
- `WS /api/rpc`

## Testing Strategy

| Test Level | Purpose |
|---|---|
| Domain unit | Pure entities, transition policy, runnability specs |
| Application unit | Services and command/query handlers with memory adapters |
| Adapter unit | FSDB repository path/layout/event compatibility |
| Integration | CommandBus + FSDB adapters |
| E2E | Daemon, UI, SSE, external FSDB edits |
| Contract | Command/query schemas and output shape |

Required validation per phase:

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
- `rtk pnpm lint`
- targeted tests for changed handlers/services

## Rollout Strategy

Use strangler pattern.

Do not rewrite everything at once.

Migration rule:

1. Add new service.
2. Write tests against new service.
3. Make existing facade delegate to service.
4. Keep public command/query API stable.
5. Remove old direct logic only after tests prove parity.

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Behavior regression during extraction | high | Facade delegation and parity tests |
| Too many packages too early | medium | Start as folders, extract packages later |
| Abstracting before boundaries stabilize | medium | Only introduce ports where multiple consumers exist |
| Event ordering bugs | high | Synchronous EventBus first, persisted events later |
| Snapshot cache stale | high | Keep direct FSDB snapshot fallback initially |
| Tests become slower | medium | Add memory repositories for service tests |
| CLI compatibility breaks | medium | Keep FSDB compatibility wrappers during migration |

## Non Goals

- No change to UI behavior.
- No storage migration away from filesystem yet.
- No removal of existing command/query names.
- No full event-sourcing rewrite.
- No deep inheritance hierarchy.
- No framework introduction.

## Acceptance Criteria

The refactor is successful when:

- `/api/state` is served by `BoardService`, not orchestrator query handling.
- Basic task mutations are in `TaskService`.
- Orchestrator focuses on workflow/agents/scheduler/gates.
- FSDB is an adapter behind repositories.
- New command handlers can be added without editing a central `if` chain.
- Runnability rules are isolated and independently tested.
- UI still updates after commands and external FSDB edits.
- Unit and E2E tests pass.

## Recommended First PR

Implement Phase 1 only.

Why:

- Smallest meaningful cut.
- Directly addresses noisy `board.snapshot` logs.
- Creates first service boundary with low behavior risk.
- Does not require changing scheduler or agent workflow.

Expected files:

- `packages/board-service/package.json`
- `packages/board-service/src/index.js`
- `apps/daemon/src/server.js`
- `packages/orchestrator/src/index.js`
- `package.json`
- `pnpm-lock.yaml`
- `tests/unit/board-service.test.js`
- `tests/e2e/kanban.spec.js`

Validation:

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
- idle daemon logs no longer show orchestrator handling `board.snapshot` repeatedly

