# Kanban Code Agent — Guia de Uso

Sistema de orquestração multi-agent com interface web kanban.

## Instalação

```bash
pnpm install
pnpm build
```

Requer Node.js 22+.

## Modos de Execução

### Modo Servidor (API + UI)

Inicia o servidor HTTP com API REST, WebSocket e interface web:

```bash
pnpm start:server
# ou
pnpm start -- server
```

Acesse `http://localhost:3000` para a interface web.

Variáveis de ambiente:
- `SWARM_PORT` — porta do servidor (default: 35000)
- `SWARM_DATA_DIR` — diretório de dados (default: `~/.kca`)
- `SWARM_LOG_LEVEL` — nível de log (default: `info`)
- `SWARM_RUN_TIMEOUT_MS` — timeout por run (default: 300000)
- `SWARM_MAX_CONCURRENT_RUNS` — limite de runs simultâneas (default: 4)
- `SWARM_ISOLATION` — `inproc` ou `docker` (default: `inproc`; `docker` roda o worker em container via worker UDS montado)
- `SWARM_WORKER_IMAGE` — opcional; imagem do worker docker (default: `node:24-slim`)
- `SWARM_WORKER_MEMORY_MAX` — opcional; valor de `-m` (memória) do container (ex.: `2g`)
- `SWARM_WORKER_CPU_QUOTA` — opcional; mapeado para `--cpus` do container (ex.: `200%` → `2`)
- `SWARM_WORKER_HOLD_MS` — opcional para debug; mantém o container `kca-*` vivo por N ms após o run
- `CREDENTIALS_DIRECTORY` ou `SWARM_GIT_TOKEN` — token Git usado via `GIT_ASKPASS`, sem gravar o token em `.swarm`

### Modo Runner (CLI)

Executa uma única task e imprime o sumário:

```bash
pnpm start:run -- "Título da task"
# ou
pnpm start -- run "Título da task"
```

Opcões:
- `--model <alias>` — modelo: `fast`, `balanced`, `deep`
- `--effort <level>` — esforço: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
- `--attach <path>` — anexar arquivo (pode repetir)
- `--simulate-restart` — simular crash e recuperação

### Modo Dev (TSX)

```bash
pnpm dev -- server
pnpm dev -- run "Task title"
```

## Interface Web

Rotas:
| Rota | Descrição |
|------|-----------|
| `/` | Kanban Board com colunas por status |
| `/projects` | Grid de projetos |
| `/projects/:id` | Detalhe do projeto |
| `/settings` | Configurações (aparência, providers, avançado) |

URL state: `?task=<id>&tab=<chat|prompt|workflow>`

## API REST

Base URL: `http://localhost:3000`

### Tasks
```
GET    /api/tasks              Listar tasks
GET    /api/tasks/:taskId      Detalhe da task
POST   /api/tasks              Criar task
PATCH  /api/tasks/:taskId      Atualizar task
POST   /api/tasks/:taskId/approve  Aprovar task em REVIEW
POST   /api/tasks/:taskId/reject   Rejeitar REVIEW com feedback
POST   /api/tasks/:taskId/retry    Reexecutar task finalizada/REVIEW
DELETE /api/tasks/:taskId      Cancelar task
```

Tasks aceitam `projectIds` para vincular 0, 1 ou N projetos. Tasks vinculadas a
projeto com `gitUrl` rodam em `.swarm/tasks/<taskId>/workspace/<slug>/`.

### Agents
```
GET    /api/agents             Listar agents
GET    /api/agents/:name       Detalhe do agent
PATCH  /api/agents/:name       Atualizar config
```

### Projects
```
GET    /api/projects           Listar projetos
POST   /api/projects           Criar projeto
GET    /api/projects/:id       Detalhe do projeto
PATCH  /api/projects/:id       Atualizar projeto
DELETE /api/projects/:id       Remover projeto
```

Projeto usa `slug`, `gitUrl`, `defaultBranch` e `autoMerge`. `autoMerge=false`
para em `REVIEW`; `autoMerge=true` aprova o merge final automaticamente.

### Settings
```
GET    /api/settings           Ver configurações
PATCH  /api/settings           Atualizar configurações
```

### Events (SSE)
```
GET    /api/events             Stream global de eventos
GET    /api/events/:taskId     Stream filtrado por task
```

### WebSocket
```
ws://localhost:3000/ws
```

Mensagens:
- Client → Server: `{ "type": "subscribe", "taskId": "..." }`
- Server → Client: `{ "type": "event", "event": {...} }`
- Server → Client: `{ "type": "state", "tasks": [...] }`

## Estrutura de Dados

```
.swarm/
├── events/
│   └── current.jsonl     # Event log append-only
├── state.snapshot.json    # Snapshot do estado
├── logs/
│   ├── orchestrator.jsonl # Logs do orquestrador
│   └── audit.jsonl        # Trilha de auditoria
├── projects/
│   └── {slug}/
│       ├── project.json   # Configuração do projeto
│       └── repo.git/      # Mirror Git compartilhado
└── tasks/
    └── {taskId}/
        ├── task.yml       # Estado da task
        ├── chat.jsonl     # Histórico de chat
        ├── session.jsonl  # Sessão Pi
        ├── artifacts.yaml # Artefatos
        ├── attachments/   # Anexos
        ├── artifacts/     # Artefatos gerados
        └── workspace/     # CWD isolado da execução
```

## Configuração via Arquivo

Crie `swarm.yml` na raiz do projeto:

```yaml
port: 3000
dataDir: ~/.kca
logLevel: info
runTimeoutMs: 300000
maxConcurrentRuns: 4
isolation: inproc
models:
  fast:
    provider: deepseek
    modelId: deepseek-v4-flash
  balanced:
    provider: deepseek
    modelId: deepseek-v4-flash
  deep:
    provider: deepseek
    modelId: deepseek-v4-pro
```

Variáveis de ambiente têm prioridade sobre o arquivo.
