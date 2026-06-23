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
- `SWARM_PORT` — porta do servidor (default: 3000)
- `SWARM_DATA_DIR` — diretório de dados (default: `.swarm`)
- `SWARM_LOG_LEVEL` — nível de log (default: `info`)
- `SWARM_MAX_CONCURRENCY` — tasks simultâneas (default: 3)
- `SWARM_RUN_TIMEOUT_MS` — timeout por run (default: 300000)

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
DELETE /api/tasks/:taskId      Cancelar task
```

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
└── tasks/
    └── {taskId}/
        ├── task.yml       # Estado da task
        ├── chat.jsonl     # Histórico de chat
        ├── session.jsonl  # Sessão Pi
        ├── artifacts.yaml # Artefatos
        ├── attachments/   # Anexos
        └── artifacts/     # Artefatos gerados
```

## Configuração via Arquivo

Crie `swarm.yml` na raiz do projeto:

```yaml
port: 3000
dataDir: .swarm
logLevel: info
maxConcurrency: 3
runTimeoutMs: 300000
models:
  fast:
    provider: openrouter
    modelId: openai/gpt-5.4-nano
  balanced:
    provider: openrouter
    modelId: deepseek/deepseek-v4-flash
  deep:
    provider: openrouter
    modelId: deepseek/deepseek-v4-pro
```

Variáveis de ambiente têm prioridade sobre o arquivo.
