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

Variáveis de ambiente (servidor):
- `SWARM_PORT` — porta do servidor (default: 35000)
- `SWARM_HOST` — host de bind (default: `::`, dual-stack IPv4/IPv6)
- `SWARM_DATA_DIR` — diretório de dados (default: `~/.kca`)
- `SWARM_LOG_LEVEL` — nível de log (default: `info`)
- `SWARM_RUN_TIMEOUT_MS` — timeout por run (default: 300000)
- `SWARM_MAX_CONCURRENT_RUNS` — limite de runs simultâneas (default: 4)
- `SWARM_ISOLATION` — `inproc` ou `docker` (default: `inproc`; `docker` roda o worker em container — ver "Isolamento Docker")
- `SWARM_AUTH_TOKEN` — opcional; quando setado, ativa bearer-token auth em toda a API

Governança / retries (opcionais):
- `SWARM_MAX_TASK_RETRIES` — tentativas por task antes de `FAILED` (default: 3)
- `SWARM_MAX_TECHNICAL_RETRIES` — retries técnicos de run (default: 2)
- `SWARM_RETRY_BASE_DELAY_MS` — base do backoff de retry (default: 2000)
- `SWARM_MAX_TOTAL_COST` — teto de custo agregado (default: sem limite)
- `SWARM_EVALUATION_GATE` — `1` liga o gate de avaliação (QA obrigatório no Manager root)

Isolamento Docker (só quando `SWARM_ISOLATION=docker`):
- `SWARM_WORKER_IMAGE` — imagem base do worker (default: `node:24-slim`)
- `SWARM_WORKER_MEMORY_MAX` — valor de `-m` (memória) do container (ex.: `2g`)
- `SWARM_WORKER_CPU_QUOTA` — mapeado para `--cpus` do container (ex.: `200%` → `2`)
- `SWARM_WORKER_HOLD_MS` — debug; mantém o container `kca-*` vivo por N ms após o run
- `SWARM_WORKER_BUNDLE_DIR` — diretório do worker bundle (node + codex + `worker.mjs`) montado read-only em `/kca/bin`; gerado por `pnpm build:worker` (ver "Isolamento Docker")

Agents / Codex (opcionais):
- `SWARM_CODEX_BIN` — binário do `codex app-server` (default: `codex`; em Docker, o codex do bundle montado)
- `SWARM_CODEX_MODEL` — modelo único usado pelo agent Codex (default: `gpt-5-codex`; o alias fast/balanced/deep é ignorado para Codex)
- `CODEX_HOME` — diretório de auth/config do Codex; o Master resolve para `<dataDir>/.swarm/auth/codex/` e monta o mesmo dir em todo container
- `DEEPSEEK_API_KEY` — key do provider deepseek do Pi (settings tem prioridade, com fallback para esta envvar)

Credenciais Git:
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

## Agents (Pi e Codex)

Duas implementações de agent rodam em paralelo em tasks diferentes:

- `pi` — Pi SDK (`@earendil-works/pi-coding-agent`), agent padrão.
- `codex` — `codex app-server` (JSON-RPC 2.0 sobre stdio), com decisão
  estruturada nativa via `outputSchema`.

Seleção:

- **Default global** — Settings → Providers → "Agent default" (`Pi`|`Codex`),
  persistido em `.swarm/settings.json` (0600) e usado por tasks que não
  especificam agent.
- **Override por task** — o dialog "Nova Tarefa" tem um seletor de `Agent`;
  a task carrega `runtimeConfig.agent` e faz round-trip em snapshot/replay.
- **Herança** — subtask criada via `create_subtask` herda o agent do pai.

Ambos os agents recebem prompts idênticos (o Codex reusa a montagem de prompts
do Pi) e as mesmas tools do Master (`post_message`, `create_subtask`,
`ask_human`, etc.).

## Auth do Codex (login único)

O Codex usa um `CODEX_HOME` **compartilhado** em `<dataDir>/.swarm/auth/codex/`
(dir 0700, `auth.json` 0600). Login é feito uma vez pela UI e reutilizado por
todos os runs, inclusive em containers (que montam o mesmo diretório de auth).

Settings → Providers → bloco **Codex**:

- **API key** — cola a key (`codex login --with-api-key`); a key só transita por
  stdin, nunca por argv/log. Rota: `POST /api/settings/codex/login`
  `{method:'apiKey', apiKey}`.
- **Device code** — inicia o fluxo device-code (`account/login/start` do
  app-server) e exibe URL + código. Rota:
  `POST /api/settings/codex/login` `{method:'deviceCode'}`.
- **Status** — badge "conectado/não conectado" via
  `GET /api/settings/codex/status` (`account/read`; nunca inclui tokens).
- **Logout** — `POST /api/settings/codex/logout` remove o `auth.json`
  compartilhado.

O login/refresh é serializado no Master (concorrentes recebem `409`); os
workers apenas montam o auth e nunca iniciam login.

## Isolamento Docker

`SWARM_ISOLATION=docker` **substitui** o antigo modo systemd. O worker roda em
um container efêmero (`docker run -d --rm --init --name kca-<taskId>-<runId>`):

- **Mounts** — `<dataDir>` em `/kca/data`, o app dir read-only em `/kca/app`,
  e o worker bundle read-only em `/kca/bin`. O `CODEX_HOME` compartilhado é
  montado (via `<dataDir>`) para reusar o auth.
- **Limites** — `-m <SWARM_WORKER_MEMORY_MAX>`, `--cpus` (de
  `SWARM_WORKER_CPU_QUOTA`, ex.: `200%` → `2`), `--stop-timeout 5`.
- **Tradução de paths** — os paths de socket/CODEX_HOME passados ao worker são
  os **do container**; o supervisor traduz host↔container.
- **Segredos** — provider keys e token Git vão por `--env-file` (0600), nunca
  no argv. Rodapé sem acesso ao resto do host.
- **Cancel/cleanup** — cancel = `docker stop`; `--rm` remove ao sair.
- **Worker bundle** — rode `pnpm build:worker` para gerar `dist-worker/`
  (`worker.mjs` + `mcp-bridge.mjs` + binários `node` e `codex` montáveis). O
  bundle é single-file (esbuild) e roda em qualquer imagem glibc (devcontainers
  padrão são Debian). Aponte `SWARM_WORKER_BUNDLE_DIR` para esse diretório.

Rodar `SWARM_ISOLATION=docker` **de dentro do container deployado** exige montar
o Docker socket do host — ver `docker-compose.yml`.

## Devcontainer por projeto

Um projeto pode declarar `devcontainerPath` (ex.:
`.devcontainer/devcontainer.json` no repo do projeto). Nesse caso a imagem do
run é construída com `devcontainer build` (`@devcontainers/cli`), com as
features aplicadas, e cacheada por hash do `devcontainer.json` + Dockerfile
(tag `kca-devc-<slug>-<hash>`). Sem devcontainer, o run usa a imagem worker
padrão (`SWARM_WORKER_IMAGE`).

Limitações deste corte:

- `dockerComposeFile` no devcontainer → **erro claro** (não suportado; o run é
  nosso `docker run`).
- `runArgs` e lifecycle hooks do devcontainer → **ignorados**.

Editável na UI em Projects (campo "Devcontainer"); path é validado contra
traversal (`../`, absoluto, `C:`).

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
