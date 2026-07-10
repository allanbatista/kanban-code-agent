# F4.3 — Front↔back browser validation (agents + container isolation)

Validação manual/Playwright do fluxo de UI para a fase 4 do
`plan-agents-and-container-isolation.md`. Escopo: navegador real dirigido via
Playwright MCP contra a stack rodando localmente.

## Ambiente

- **Data:** 2026-07-10
- **Backend:** `pnpm start:server` (tsx), porta `35043`, `SWARM_ISOLATION=inproc`
- **Web:** `cd web && pnpm dev` (Vite 8), porta `8843`, proxy `/api`→`35043`
- **Scratch data dir:** `/tmp/claude-1000/.../scratchpad/kca-f43-data`
  (`SWARM_DATA_DIR`) — não polui dados reais
- **CODEX_HOME compartilhado:** `<dataDir>/.swarm/auth/codex/` — deslogado
  (config.toml presente, **sem auth.json**), `GET /api/settings/codex/status`
  → `{"loggedIn":false}` (esperado no scratch)
- **DEEPSEEK_API_KEY:** presente no ambiente
- **Console do navegador:** 0 erros durante toda a sessão (1 warning benigno:
  reconexão de WebSocket durante reloads/HMR — indicador "Tempo real conectado"
  permaneceu verde)

## Resultado por item

| Item | Descrição | Status |
| --- | --- | --- |
| (a) | Selector de agent default (Pi/Codex) persiste após reload | **PASS** |
| (b) | Bloco Codex mostra status de conexão; form API-key renderiza/cancela | **PASS** |
| (c) | Projeto gitUrl vazio + devcontainerPath preenchido salva e reabre | **PASS** |
| (d) | Task com agent codex: card + drawer + falha graciosa | **PASS parcial** — falha graciosa OK; **agent NÃO é exibido no drawer** |
| (e) | Reload preserva estado | **PASS** |

## Passo a passo e evidências

### (a) Agent default selector — PASS

1. Settings → Providers. Selector "Agent default" renderiza com valor `Pi`.
   Dropdown expõe exatamente `Pi` e `Codex`.
   Evidência: `web/screenshots/f43-a-providers-agent-codex.png`
2. Troquei para `Codex` → `Salvar`. `PATCH /api/settings` → 200.
   `GET /api/settings` → `agent: "codex"`. Arquivo persistido em
   `<dataDir>/.swarm/settings.json` com permissão **0600** (`-rw-------`).
3. Reload (`/settings?section=providers`): selector volta com `Codex`.
   Evidência: `web/screenshots/f43-a-agent-codex-persisted.png`

### (b) Bloco Codex / status de conexão — PASS

1. Bloco "Codex" mostra badge **"não conectado"** (bate com CODEX_HOME scratch
   vazio; `GET /api/settings/codex/status` → `{"loggedIn":false}`).
2. Form "connect with API key" renderiza (input `sk-... (API key)` + botão
   `Conectar` desabilitado quando vazio). Digitei um valor dummy (NÃO uma key
   real) → botão `Conectar` habilita. Limpei o campo → botão volta a
   desabilitar (cancela limpo). **Nunca submeti** o form.
   Evidência: `web/screenshots/f43-b-codex-apikey-form.png`
3. Botão "Conectar via device code" renderiza (não acionado, para não iniciar
   um login real).

### (c) Projeto com devcontainerPath e gitUrl vazio — PASS

1. Projects → "Novo Projeto". Preenchi `Nome`=`F43 Devcontainer Proj` e
   `Devcontainer`=`.devcontainer/devcontainer.json`; **Git URL deixado vazio**.
   Evidência: `web/screenshots/f43-c-project-form.png`
2. `Criar` → `POST /api/projects` → 201. `GET /api/projects` retorna
   `devcontainerPath: ".devcontainer/devcontainer.json"` e sem gitUrl.
   Persistido em `<dataDir>/.swarm/projects/f43-devcontainer-proj/project.json`.
3. `Editar` reabre o dialog com `devcontainer=".devcontainer/devcontainer.json"`
   e `gitUrl=""` (verificado via DOM).
   Evidência: `web/screenshots/f43-c-project-reopen-devcontainer.png`

### (d) Task com agent codex — PASS parcial

1. Kanban do projeto → dialog "Nova Tarefa": mensagem preenchida, `Agent`
   trocado para `Codex`, projeto marcado. Botão "Criar e executar" habilita.
   Evidência: `web/screenshots/f43-d-create-task-codex.png`
2. "Criar e executar" → task criada com `runtimeConfig.agent="codex"`. Card
   aparece na coluna **Manager** com badge **"Falhou"**.
   Evidência: `web/screenshots/f43-d-task-card-failed.png`
3. **Falha graciosa (asserção principal do item d):** sequência de eventos
   `TASK_CREATED (PENDING) → TASK_QUEUED → TASK_STARTED → RUN_STARTED →
   RUN_FAILED` com retry técnico 2× → `TASK_FAILED (failureReason:"attempts")`.
   Erro propagado como eventos e como mensagens no chat do drawer; **servidor
   não caiu** (`GET /api/settings` continua 200, processo vivo).
   Evidências: `web/screenshots/f43-d-drawer-chat-failure.png`,
   `web/screenshots/f43-d-drawer-workflow-footer.png`
4. `runtimeConfig.agent="codex"` confirmado via `GET /api/tasks` e no snapshot
   em disco (`options.runtimeConfig.agent="codex"`).

**Ressalva (d):** o requisito "drawer displays agent" **não é atendido pela
UI** — ver Bug #1. O agent é armazenado e faz round-trip, mas não é exibido
em lugar nenhum do drawer/workflow (só `model · effort`).

### (e) Reload preserva estado — PASS

1. Reload da board: card `#task_1` continua na coluna Manager com "Falhou"
   (Manager `0/1`).
2. Snapshot em disco (`<dataDir>/.swarm/state.snapshot.json`) contém `task_1`
   com `status="FAILED"` e `options.runtimeConfig.agent="codex"`,
   `effort="xhigh"`, `model="balanced"`.
   Evidência: `web/screenshots/f43-e-reload-persist.png`

## Bugs / observações encontrados (documentados, NÃO corrigidos — fora do escopo)

### Bug #1 — Drawer não exibe o agent (falha do requisito d)
`web/src/components/kanban/TaskDrawer.tsx:285` renderiza apenas
`🤖 {task.runtimeConfig.model} · {task.runtimeConfig.effort}` (ex.:
"balanced · xhigh"). O campo `runtimeConfig.agent` **nunca é exibido** no
rodapé do drawer nem na aba Workflow — apesar de o comentário na linha 266
dizer "Footer: agent + status + métricas". A palavra "codex" só aparece na UI
por estar no título da task. O requisito F4.3(d) "runtimeConfig displays agent"
não é satisfeito. Correção sugerida: acrescentar `· {task.runtimeConfig.agent}`
ao badge.

### Bug/robustez #2 — Socket UDS do MCP bridge do Codex estoura o limite de path
A run do Codex falhou ao dar bind no UDS de tools:
`listen EINVAL: invalid argument
<dataDir>/.swarm/workers/task_1-run_1-codex-tools.sock`. O path absoluto do
socket (dataDir scratch ~130 chars + nome do socket) excede o limite
`sun_path` (~108 chars no Linux) → `EINVAL`. É específico do Codex (o MCP
bridge sempre cria esse socket; Pi em inproc não). **Consequência para esta
validação:** o scratch env **não exercitou** o caminho de "codex-auth ausente"
— a run falhou antes, no bind do socket. A asserção de "falha graciosa" segue
válida (FAILED com eventos, sem crash). Risco latente: um dataDir moderadamente
longo quebra runs Codex mesmo em produção/inproc. Sugestão: encurtar o nome do
socket ou usar um diretório curto (`/tmp` hashed) para os UDS.

### Observação #3 — CreateTaskDialog não herda o agent default dos Settings
`web/src/components/kanban/CreateTaskDialog.tsx:17` inicia `agent` com o
literal `'pi'` (`useState('pi')`), ignorando o `agentDefault` dos Settings
(que estava `codex` após o item a). O plano diz "agent default global usado por
novas tasks"; na UI o dialog sempre parte de `pi` e envia agent explícito.
Provavelmente inofensivo se o backend resolver o default quando o campo é
omitido, mas a UI nunca omite. Vale alinhar o default do dialog ao dos
Settings.

### Observação #4 — Effort remapeado de `medium` para `xhigh`
Selecionei effort `Medium` no dialog. O evento `TASK_CREATED` registra
`runtimeConfig.effort:"medium"`, mas o estado persistido/`GET /api/tasks`
mostra `effort:"xhigh"`. Algo entre a criação e a resolução do runtimeConfig
reescreveu o effort. Discrepância menor, vale um follow-up para confirmar se é
normalização intencional ou bug.

## Teardown

Ambos os servidores (backend `35043` e web `8843`) encerrados ao final da
validação. Nenhum dado real tocado — tudo sob o scratch dataDir.
