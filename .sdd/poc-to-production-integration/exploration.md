# Exploration: POC → Production Integration

## 1. POC Architecture

### Backend (`poc/index.ts` — 2320 linhas, monolito)

- **Event-driven**: `EventEmitter` para ciclo de vida de tasks
- **Task lifecycle**: `PENDING → QUEUED → RUNNING → WAITING → COMPLETED | FAILED | CANCELLED`
- **Subtask delegation**: agentes criam subtasks via tool `create_subtask`
- **Wait groups**: `WAIT_ALL` (todas completam) e `ON_DEMAND` (entrega individual)
- **Retry com escalabilidade**: model e effort ajustados automaticamente
- **Budget tracking**: tokens, custo, timeout por run
- **Persistência em filesystem**: snapshot JSON + event log NDJSON + chat JSONL por task
- **Agentes embutidos**: Manager, Produto, Engineer, Generic (4 agentes)
- **Pi SDK integration**: sessão Pi por task, resource loader, extension tools

### Frontend (`poc/layout/` — React + Vite + shadcn/ui)

- **KanbanBoard**: drag-and-drop com `@dnd-kit`
- **Colunas**: Inbox, Manager, Produto+Generic, Architecture+Engineer, CodeReviewer+QA, Done
- **CreateTaskDialog**: título, agente, model, effort
- **TaskDrawer**: abas Chat, Workflow, History, Summary
- **WorkflowView**: visualização de árvore de dependências
- **7 agentes mockados**: Manager, Produto, Generic, Architecture, Engineer, Code Reviewer, QA
- **DADOS MOCKADOS** — sem integração com API real

---

## 2. Production Architecture

### Domain (`src/domain/`)

- Tipos com const objects (`TASK_STATUS`, `WAIT_GROUP_MODE`, etc.)
- Entidade `Task` com serialize/deserialize
- Interfaces: `Agent`, `TaskRun`, `WaitGroup`, `SwarmEvent`
- IDs gerados via `createTaskId()`, `createRunId()`, `createEventId()`
- `src/domain/entities/` — **vazio** (apenas `.gitkeep`)

### Application (`src/application/`)

- **Orquestrator**: refatorado do monólito POC, injeção de dependências via `OrquestratorDeps`
- **PiAgentClient**: interface `AgentRunner` (inversão de dependência)
- **PromptBuilder**: construção de prompts (puro, sem efeitos)
- **Scheduler**: fila de tasks, índice de dependências wait
- **WorkerPool**: controle de concorrência
- **BudgetTracker**: limites de tokens/custo
- **DecisionParser**: validação de JSON do agente
- `src/application/services/` — **vazio** (apenas `.gitkeep`)

### Infrastructure (`src/infrastructure/`)

- **Persistence**: `EventStore`, `SnapshotStore`, `TaskFileStore` (filesystem)
- **API**: Fastify HTTP + WebSocket
  - `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:taskId`
  - `GET/PATCH /api/agents`, `GET/PATCH /api/agents/:name`
  - `GET/POST/PUT/DELETE /api/projects` (em memória)
  - `GET /api/settings`, `PATCH /api/settings`
  - `GET /api/events` (SSE stream)
  - `WS /ws` (WebSocket com subscribe por taskId)
- **Filesystem**: `PathSandbox` (validação de caminhos, prevenção de traversal)
- **Config**: arquivo `swarm.yml`/`.yaml`/`.json` + env vars (`SWARM_PORT`, etc.)
- **Logging**: `Logger` com níveis

### CLI (`src/cli/`)

- `swarm server` — inicia API + serve UI de `web/dist`
- `swarm run <titulo>` — executa task isolada
- `OrquestratorFactory` — DI completa
- `PiSdkAgentRunner` — wrapper do Pi SDK

---

## 3. Gap Analysis

### 3.1 Frontend não integrado (MAIOR GAP)

| Feature POC | Status Production |
|---|---|
| KanbanBoard + drag-and-drop | Não existe |
| CreateTaskDialog | Não existe |
| TaskDrawer (Chat/Workflow/History/Summary) | Não existe |
| ProjectsGrid / ProjectDetail | API existe, UI não |
| SettingsLayout | API existe, UI não |
| WorkflowView (árvore de dependências) | Não existe |
| StatusBadge, RuntimeConfigSelector, etc. | Não existe |

**Frontend POC usa mocks.** Production tem API pronta mas sem UI servida.

### 3.2 Agentes incompletos

| Agente | POC Frontend | Production Backend |
|---|---|---|
| Manager | Sim | Sim |
| Produto | Sim | Sim |
| Generic | Sim | Sim |
| Engineer | Sim | Sim |
| Architecture | Sim | **Não** |
| Code Reviewer | Sim | **Não** |
| QA | Sim | **Não** |

### 3.3 Projects — persistência

- POC frontend tem ProjectsGrid/ProjectDetail
- Production backend armazena projects **em memória** (perde ao reiniciar)
- Precisa persistência em arquivo (similar a tasks)

### 3.4 Endpoints faltantes na API

| Dado | Existe na API? | Nota |
|---|---|---|
| Upload de attachment | **Não** | `--attach` funciona no CLI, mas sem `POST /api/tasks/:id/attachments` |
| Execution report / summary table | **Não** | Orquestrator tem `formatSummaryTable()` mas sem endpoint |
| Workflow graph data | **Não** | `formatExecutionGraph()` sem endpoint |
| Chat history por task | **Parcial** | Chat está no objeto task, sem stream individual |
| Subtask creation via API | **Não** | Só via tool do agente |

### 3.5 Real-time

- Production tem WebSocket (`/ws`) e SSE (`/api/events`) — **funcionais**
- Frontend POC **não tem** hook de WebSocket/SSE
- Precisa: hook `useWebSocket` ou `useSSE` no frontend

### 3.6 Frontend build output

- `src/cli/server.ts` serve de `web/dist` — diretório não existe no repo
- Frontend precisa ser buildado e colocado em `web/dist`
- Ou servido via proxy em dev (Vite dev server)

---

## 4. Recommendations

### Prioridade 1 — Wiring Frontend ↔ API

1. Mover `poc/layout/` para `web/` (ou criar `web/` novo)
2. Substituir mocks por chamadas HTTP reais:
   - `kanbanStore.ts` → fetch de `/api/tasks`
   - `mockAgents.ts` → fetch de `/api/agents`
   - `mockProjects.ts` → fetch de `/api/projects`
3. Criar hooks de real-time:
   - `useWebSocket(url)` → conecta em `/ws`, recebe `state` e `event`
   - Atualiza store Zustand em tempo real
4. Configurar proxy Vite → API em dev (`vite.config.ts`)

### Prioridade 2 — Agentes faltantes

Adicionar ao `src/cli/orquestrator-factory.ts`:
- `Architecture` — focado em design de sistemas
- `CodeReviewer` — focado em revisão de código
- `QA` — focado em testes e qualidade

### Prioridade 3 — Endpoints faltantes

1. `POST /api/tasks/:taskId/attachments` — upload de arquivos
2. `GET /api/tasks/:taskId/chat` — histórico de chat (stream ou paginado)
3. `GET /api/report/summary` — execution report (tokens, custo, duração)
4. `GET /api/report/graph` — execution graph (para WorkflowView)
5. `POST /api/tasks/:taskId/subtasks` — criar subtask via API

### Prioridade 4 — Projects persistente

- Criar `ProjectFileStore` em `src/infrastructure/persistence/`
- Salvar em `.swarm/projects/` (similar a tasks)

### Prioridade 5 — Build pipeline

- `web/` com `package.json` próprio ou integrado ao root
- Script `build` que gera `web/dist/`
- `swarm server` serve `web/dist` automaticamente

---

## 5. Resumo Visual

```
POC (tudo junto)                    Production (separado)
┌─────────────────────┐            ┌──────────────────────────┐
│ poc/index.ts        │            │ src/domain/              │
│   - Orquestrator    │    →       │   - types, entities      │
│   - Task, Agent     │            │ src/application/         │
│   - Persistence     │            │   - orquestrator         │
│   - CLI             │            │   - scheduler, pool      │
│                     │            │   - pi-client            │
│ poc/layout/         │            │ src/infrastructure/      │
│   - React UI        │    →       │   - api (Fastify)        │
│   - Mocks           │   ???      │   - persistence          │
│   - 7 agentes       │            │   - config               │
│                     │            │ src/cli/                 │
│                     │            │   - server, run          │
│                     │            │                          │
│                     │            │ web/  ← PRECISA CRIAR    │
│                     │            │   - React UI (poc/layout)│
│                     │            │   - hooks reais          │
└─────────────────────┘            └──────────────────────────┘
```

**Gaps críticos para MVP do usuário final:**
1. Frontend conectado à API (trocar mocks por HTTP/WS)
2. 3 agentes faltantes (Architecture, CodeReviewer, QA)
3. File upload para attachments
4. Report/graph endpoints para UI de workflow
