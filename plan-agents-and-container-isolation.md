# Agents (Pi + Codex) and Container Isolation - implementation plan

Sucede `plan-projects-and-isolation.md` (implementado em 2026-06-25). Objetivo:
deixar o sistema pronto para executar projetos de ponta a ponta com **dois
agents operacionais** (Pi e Codex), **isolamento completo via Docker**
(substituindo systemd) e **devcontainer por projeto**.

## Contrato de produto

- Dois agents em operação: `pi` (Pi SDK, atual) e `codex` (novo, via
  `codex app-server`, JSON-RPC 2.0 sobre stdio — https://learn.chatgpt.com/docs/app-server).
- Settings define o **agent default global**; task pode sobrescrever via
  `RuntimeConfig.agent`; subtask herda do pai. Ambos agents podem rodar em
  paralelo em tasks diferentes.
- Settings passa a ser **persistido e fonte de runtime** (hoje
  `/api/settings` é in-memory e desconectado — `src/infrastructure/api/routes/settings.ts:70`).
- **Auth compartilhada entre agents e workers**: login do Codex (device-code
  pela UI ou `codex login --with-api-key`) grava `auth.json` em um
  `CODEX_HOME` compartilhado sob `<dataDir>/.swarm/auth/codex/`; keys de
  provider do Pi (`DEEPSEEK_API_KEY` etc.) ficam em settings com fallback
  para envvar. Todo container monta o mesmo diretório de auth — login uma
  vez, todos os runs reutilizam.
- `SWARM_ISOLATION=docker` **substitui** `systemd` (código systemd é
  removido). `inproc` continua default de dev/CI.
- Isolamento completo: workspace da task montado, sockets UDS montados,
  limites de memória/CPU/timeout, `--rm`, sem acesso ao resto do host.
- Projeto pode declarar `devcontainerPath` (ex.:
  `.devcontainer/devcontainer.json` no repo do projeto). A imagem do run é
  construída com `devcontainer build` (`@devcontainers/cli`); sem
  devcontainer, usa a imagem worker padrão.
- Segredos não aparecem em log, chat, worktree, `.swarm/events` ou
  `git config` (contrato anterior mantido).
- Fluxo validado de ponta a ponta: criar projeto → configurar auth →
  rodar task com cada agent em container → decisão → merge → gate `REVIEW`.

## Decisões de design (ancoradas no código atual)

1. **Interface `AgentClient` extraída do `PiAgentClient`.** O seam limpo já
   existe (`AgentRunner` em `src/application/pi-client.ts:55`), mas
   `Orquestrator` e `WorkerSupervisor` tipam `PiAgentClient` concreto
   (`orquestrator.ts:467,485`). Extrair a interface consumida
   (`run`, `repairInvalidOutput`, `generateTitle`) e selecionar a
   implementação na factory (`src/cli/orquestrator-factory.ts:31-82`) por
   `RuntimeConfig.agent` resolvido.
2. **`CodexAgentClient` fala JSON-RPC/stdio com `codex app-server`.**
   Handshake `initialize`/`initialized`, `thread/start`, `turn/start` com
   `{cwd, model, approvalPolicy: "never", sandboxPolicy}` e **`outputSchema`
   com o schema de decisão** — a decisão estruturada vem nativa, reduzindo
   `repairInvalidOutput` a fallback. `sandboxPolicy`: `externalSandbox`
   quando em Docker (o container é o sandbox), `workspaceWrite` em inproc.
3. **Tools do Master via MCP bridge.** Codex não aceita tools ad-hoc (só
   MCP). Criar `src/worker/mcp-bridge.ts`: MCP server stdio que encaminha
   `tools/call` para o tool-callback UDS já existente
   (`worker-supervisor.ts:232-254`, `POST /tool {name, params}`). Registrado
   uma única vez no `config.toml` do `CODEX_HOME` compartilhado; o socket
   por run chega via env `KCA_TOOLS_SOCKET` setada ao spawnar o app-server.
   Assim `post_message`, `create_subtask`, `ask_human` etc. funcionam
   idênticos nos dois agents.
4. **Docker mode no supervisor por injeção existente.** `startWorker`/
   `stopWorker` já são injetáveis (`worker-supervisor.ts:32-33,69-70`).
   `buildDockerRunArgs()` substitui `buildSystemdRunArgs()`:
   `docker run --rm --init --name kca-<taskId>-<runId> -m <mem> --cpus <n>
   -v <dataDir>/.swarm/workers:/kca/sock -v <workspace>:/kca/ws
   -v <authDir>:/kca/auth -v <workerBundle>:/kca/bin:ro -w /kca/ws <image>
   /kca/bin/node /kca/bin/worker.js --socket /kca/sock/<...>.sock`.
   Timeout mapeia para kill pelo Master (já existe via WorkerPool) +
   `--stop-timeout`. Cancel = `docker stop`. Atenção: os paths de socket
   passados ao worker são os **do container** — o supervisor traduz.
5. **Worker bundle montado, não imagem por worker.** Bundle single-file
   (esbuild) do worker + binário `node` + binário `codex` montados
   read-only em `/kca/bin`. Funciona em qualquer imagem glibc (devcontainers
   padrão são Debian). `ponytail:` mount de binários assume glibc/arch
   compatíveis; upgrade: overlay image (`FROM <devcontainer> + COPY`) se
   surgir imagem musl/incompatível.
6. **Devcontainer via `devcontainer build` apenas.** `@devcontainers/cli`
   roda no host só para construir a imagem (features aplicadas), cacheada
   por hash do `devcontainer.json` + Dockerfile. O run continua sendo nosso
   `docker run` (decisão do usuário). `runArgs`/`compose`/lifecycle hooks do
   devcontainer ficam fora de escopo com erro claro.
7. **Settings persistente em `.swarm/settings.json` (0600).**
   `registerSettingsRoutes` passa a receber orquestrator/config como as
   demais rotas (`http-server.ts:130`). Campos novos: `agent: 'pi'|'codex'`,
   keys por provider (mascaradas na leitura, preservadas se em branco —
   comportamento atual mantido). Fallback: settings → envvar → default.
8. **Login Codex pela UI.** Rotas `/api/settings/codex/login` (inicia
   device-code via `account/login/start` do app-server e retorna URL+código
   para exibir), `/api/settings/codex/status` (`account/read`), logout.
   `CODEX_HOME` compartilhado é a fonte; containers montam o diretório.
   `ponytail:` refresh concorrente de token entre N containers é risco
   conhecido; mitigação: Master serializa login/refresh, workers montam auth
   e não iniciam login. Upgrade: lock file se aparecer corrida real.
9. **`RuntimeConfig.agent`** (`src/domain/task.ts:9-12`) flui por
   `TaskOptions`, herança em `create_subtask`
   (`orquestrator.ts:1781-1794`), `resolveRuntimeConfig`
   (`orquestrator.ts:1655`) e UI (`AgentConfigDialog.tsx`,
   `RuntimeConfigSelector.tsx`).

## Plano executável

| Fase | Tarefa | Arquivos planejados | Evidência requerida | Status |
| --- | --- | --- | --- | --- |
| 0 | Extrair interface `AgentClient` e tipar Orquestrator/Supervisor por ela; seleção na factory por `RuntimeConfig.agent` (só `pi` existe ainda) | `src/application/agent-client.ts` (novo), `src/application/pi-client.ts`, `src/application/orquestrator.ts`, `src/cli/orquestrator-factory.ts` | Suíte atual verde sem mudança de comportamento; teste de factory selecionando client por agent | done — refactor retype-only, 422 testes verdes sem edição de teste |
| 0 | `RuntimeConfig.agent` + herança em subtask + API/UI | `src/domain/task.ts`, `src/application/orquestrator.ts`, `src/infrastructure/api/routes/tasks.ts`, `web/src/components/kanban/AgentConfigDialog.tsx`, `RuntimeConfigSelector.tsx` | Round-trip snapshot/replay preserva `agent`; subtask herda; UI seleciona | done — AGENT_NAME no domínio, herança em create_subtask, seletor na UI |
| 0 | Persistir settings em `.swarm/settings.json` e ligar ao runtime (agent default, provider keys, fallback envvar) | `src/infrastructure/api/routes/settings.ts`, `src/infrastructure/persistence/settings-store.ts` (novo), `src/cli/orquestrator-factory.ts`, `web/src/stores/settingsStore.ts` | Restart preserva settings; key mascarada na leitura; `resolveRuntimeConfig` usa agent default dos settings | done — SettingsStore 0600 + apiKeyResolver no runner + setDefaultAgent hot |
| 1 | `CodexAgentClient` inproc: spawn `codex app-server`, handshake, thread/turn, `outputSchema` de decisão, eventos→chat (item/agentMessage) | `src/application/codex-client.ts` (novo), `src/cli/codex-runner.ts` (novo), testes com app-server fake (stdio) | Teste roda task fake ponta a ponta com decisão estruturada; interrupt/cancel via `turn/interrupt` | pending |
| 1 | MCP bridge das tools do Master + `config.toml` do CODEX_HOME | `src/worker/mcp-bridge.ts` (novo), `src/infrastructure/security/codex-home.ts` (novo) | `create_subtask`/`post_message` chamadas pelo Codex chegam ao Orquestrator em teste | pending |
| 1 | Auth Codex compartilhada: CODEX_HOME em `.swarm/auth/codex/`, rotas login device-code/status/logout, UI em Settings | `src/infrastructure/api/routes/settings.ts`, `web/src/components/settings/ProvidersSettings.tsx` | Login device-code exibe URL+código na UI; `account/read` reporta logado; auth.json com 0600 | pending |
| 2 | `SWARM_ISOLATION=docker`: `buildDockerRunArgs`, tradução de paths host↔container, cancel via `docker stop`, limites mem/cpu | `src/infrastructure/process/worker-supervisor.ts`, `src/infrastructure/config.ts`, testes de args | Teste valida args docker (mounts, limites, rm); run real em container passa smoke `/health` via socket montado | pending |
| 2 | Worker bundle: esbuild single-file + estágio de build dos binários (node, codex) montáveis | `scripts/build-worker-bundle.mjs` (novo), `package.json` | Bundle roda `--help` num container `debian:bookworm-slim` sem node instalado | pending |
| 2 | Remover systemd (código, envvars, docs) | `worker-supervisor.ts`, `config.ts`, `docs/`, testes | `rg -i systemd src/` vazio; suíte verde | pending |
| 2 | Worker multi-agent: `worker/main.ts` seleciona runner (Pi ou Codex) pelo config serializado | `src/worker/main.ts` | Run containerizado com cada agent completa em teste | pending |
| 3 | `ProjectData.devcontainerPath` + validação + eventos + UI | `src/infrastructure/persistence/project-file-store.ts`, `src/infrastructure/api/routes/projects.ts`, `src/application/orquestrator.ts:518-534`, `web/src/components/projects/*` | CRUD + replay preservam campo; UI edita | pending |
| 3 | Build de imagem por projeto: `devcontainer build` com cache por hash; fallback imagem padrão; erro claro p/ compose/runArgs | `src/infrastructure/containers/devcontainer.ts` (novo), integração no supervisor | Projeto com devcontainer.json real gera imagem e o run usa; sem devcontainer usa default; cache hit não rebuilda | pending |
| 4 | E2E mock: fluxo completo (projeto → task por agent → container fake → decisão → merge → REVIEW) com runner/docker fakes determinísticos | `src/__tests__/e2e/*` | Suíte cobre os dois agents e os três isolation modes restantes (`inproc`, `docker`) | pending |
| 4 | Smoke live guardado por `SWARM_VALIDATION=1`: Pi (deepseek) e Codex (auth real) em Docker real | `src/__tests__/validation/` | Task real completa com cada agent; evidência registrada aqui | pending |
| 4 | Validação front↔back no browser: configurar projeto (devcontainer), logar Codex, selecionar agent, aprovar merge | roteiro + screenshots | Fluxo manual/Playwright documentado com evidência | pending |
| 5 | Docs + Graphify | `docs/usage/README.md`, `docs/software/README.md`, `graphify-out/` | Docs cobrem agents/docker/devcontainer/auth; graphify sync verde | pending |

## Definition of Done

- Task roda com `agent: pi` e `agent: codex`, selecionado em Settings com
  override por task; subtask herda.
- Settings sobrevive a restart e alimenta o runtime (agent default + keys).
- Login Codex feito uma vez (UI, device-code ou API key) e reutilizado por
  todos os runs, inclusive em containers.
- `SWARM_ISOLATION=docker` roda o worker em container com workspace e
  sockets montados, limites aplicados e cleanup garantido (`--rm` + stop).
- Nenhuma referência a systemd resta no código.
- Projeto com `devcontainerPath` roda na imagem construída via
  `devcontainer build`; sem devcontainer, imagem padrão.
- Segredos (keys, auth.json, git token) fora de log/chat/eventos/worktree.
- E2E mock verde em CI; smoke live com os dois agents registrado.
- `ponytail-review` da fase antes de marcá-la `done`.

## Riscos conhecidos

- **Binários montados vs. imagem musl/arch diferente** — fallback overlay
  image documentado (decisão 5).
- **Refresh concorrente do auth.json do Codex** — serializado no Master
  (decisão 8).
- **`outputSchema`/`dynamicTools` do app-server podem mudar** (partes
  experimentais); fixar versão do binário `codex` no bundle e cobrir com
  teste de contrato do handshake.
- **Devcontainers com features pesadas** tornam o primeiro build lento —
  cache por hash mitiga; build assíncrono com task em `QUEUED` se doer.

## Decisões adiadas

- Keys/credenciais por projeto (auth é global/compartilhada neste corte).
- Transporte WebSocket/unix-socket do app-server (stdio basta).
- `runArgs`, docker-compose e lifecycle hooks de devcontainer.
- Multi-host / registry de imagens.
- Pool de containers warm (um container por run neste corte).
