# Kanban Code Agent Plan v2

Data: 2026-06-12
Status: PLAN_READY_PRODUCT_NOT_READY
Base funcional: `kanban-code-agent-spec-v2.md`
Base tecnica auditada: `apps/*`, `packages/*`, `tests/*`, `.features/20260611-1906-kanban-code-agent-mvp/*`, `current_state/kanban-code-agent/*`

## 1. Objetivo

Evoluir a implementacao atual para um Kanban local-first que simula uma equipe completa de desenvolvimento:

- gerente;
- produto;
- design;
- engenharia;
- qualidade;
- review;
- deployment.

Cada papel deve ter definicoes, prompts, permissoes, tools, limites e comportamento proprios. Os papeis operam tarefas em paralelo. O banco de dados permanece filesystem-first. O assistant global e o assistant da task ajudam conforme o escopo. Durante planning, uma task master pode criar N subtasks em DAG, com execucao paralela controlada por locks, semaforos e politicas deterministicas do orchestrator.

## 2. Sumario Executivo

A implementacao atual cobre uma boa fundacao de MVP: FSDB em YAML/Markdown/JSONL, daemon HTTP/SSE/WebSocket, UI React conectada, commands tipados, worktree basico, eventos append-only, prompts editaveis e adapter Pi isolado.

Ela ainda nao entrega o objetivo final. O produto atual e mais um simulador procedural de Kanban com agents basicos do que uma equipe multiagente especializada. Os maiores gaps sao:

- papeis alvo do usuario nao existem como dominio; existem apenas `assistant`, `architect`, `engineer`, `validator`, `reviewer`, `hook-agent`;
- planning/DAG existe como arquivo e comando simples, mas nao como planejador inteligente de N subtasks nem como scheduler continuo;
- semaforos e locks sao diagnosticados em `why_not_running`, mas nao ha fila/worker que consuma tasks automaticamente em paralelo;
- assistant fake ainda usa matching de palavras-chave quando Pi real nao esta ativo;
- quando Pi real esta ativo, os testes ficaram permissivos e nao provam que tools foram chamadas;
- arquitetura concentra regras demais em `packages/orchestrator/src/index.js`;
- UI mostra abas e chats, mas varias abas sao paineis estaticos, sem editor real de DAG, acceptance, arquivos, eventos ou artefatos;
- worktree/merge cobre casos basicos, mas nao implementa fluxo completo parent feature -> subtasks -> merge sequencial -> deployment.

## 2.1 Definicoes de Pronto

Este documento usa tres niveis separados de prontidao. Eles nao podem ser misturados:

| Termo | Definicao | Status atual |
|---|---|---|
| Plano pronto | O plano descreve o estado real, gaps, contratos, fases, evidencias e criterios de validacao sem deixar decisoes centrais em aberto. | Sim, este documento. |
| MVP demonstravel | A aplicacao liga, cria/edita/move tasks, persiste FSDB e roda comandos basicos com testes. | Parcial. |
| Produto pronto | O usuario liga a aplicacao, cria uma task real e ve o fluxo autonomo completo funcionando de ponta a ponta, com tasks concorrentes, roles especializados, DAG, semaforos, worktrees, review, deployment e UI integrada. | Nao. |

Para este projeto, "pronto" significa somente "Produto pronto". Teste unitario verde, E2E basico, adapter fake, command manual ou UI estatica nao contam como pronto.

## 2.2 Clausulas Obrigatorias de Produto Pronto

| Clausula | Obrigatorio para considerar pronto | Evidencia minima |
|---|---|---|
| C1 Boot local | `pnpm`/script dev liga daemon e web sem setup manual alem de env documentado. | Comando unico, `/health` ok, UI abre. |
| C2 Criacao pela UI | Usuario cria task pelo board ou assistant global. | Task aparece no board e em `tasks/<id>/task.yaml`. |
| C3 Planning autonomo | Task master entra em planning e gera N subtasks por assistant/product/architect sem o usuario escrever YAML. | `planning.yaml`, `subtasks.yaml`, eventos `planning.*`/`subtasks.spawned`. |
| C4 DAG valido | Subtasks possuem grafo sem ciclos, `needs/provides`, locks, semaforos, role e aceite proprio. | Validador de DAG e teste com grafo valido/invalido. |
| C5 Scheduler real | Orchestrator roda loop autonomo, descobre subtasks runnable e inicia execucoes. | Eventos `scheduler.tick`, `agent.queued`, `agent.started` sem clique manual em cada subtask. |
| C6 Concorrencia real | Pelo menos duas subtasks independentes rodam em paralelo respeitando limites. | Runtime mostra runs simultaneos; teste prova maxParallel e tokens. |
| C7 Semaforos atomicos | Semaforos sao adquiridos/liberados por run, com lease persistido e protecao contra corrida. | `settings/runtime/semaphores.yaml` ou store equivalente com leases; teste de contencao. |
| C8 Roles completos | Gerente, produto, design, engenharia, qualidade, review e deployment existem como roles configuraveis. | `settings/roles/*.yaml`, prompts, toolsets e limites por role. |
| C9 Comportamento por role | Cada role recebe contexto, tools e gate de saida especificos. | Session JSONL mostra role/scope/tools; tests por role. |
| C10 Assistant por escopo | Chat global e chat da task persistem historico e chamam commands conforme permissao do escopo. | Recarregar UI preserva chats; eventos e FSDB comprovam actions. |
| C11 Worktrees integrados | Parent feature worktree e child worktrees sao criados automaticamente quando necessario. | Git fixture prova parent/child, branch, metadata e cwd de agent. |
| C12 Merge/review | Subtasks finalizadas passam por review e merge sequencial no parent feature. | Eventos `review.*`, `merge.requested`, `subtask.merged` ou `merge.conflict`. |
| C13 Deployment | Role deployment executa gate configurado, registra release/deploy e rollback info. | Artifact de deploy, log, status final e teste com command fake. |
| C14 Observabilidade UI | Board, modal da task e painel orchestrator mostram fila, running, semaforos, bloqueios, DAG, merges e deploy. | Screenshots desktop/mobile e E2E de navegacao. |
| C15 Evidencia final | Current-state documenta runtime real com storage limpo. | `current_state/kanban-code-agent/*` atualizado com screenshots, API probes e comandos. |

## 2.3 Anti-criterios

O produto nao pode ser marcado como pronto se qualquer item abaixo for verdadeiro:

- fluxo depende de clicar manualmente em "Rodar" para cada subtask;
- assistant cria resposta textual mas nao altera FSDB/eventos;
- unit tests aceitam tanto `reply` quanto `action` sem provar efeito persistido;
- UI mostra texto estatico em abas de planning, subtasks, eventos, arquivos ou deployment;
- concorrencia e semaforos aparecem apenas em `why_not_running`;
- adapter fake e usado como unica prova de comportamento de agent;
- Pi real so e validado por dry-run sem tool-call;
- deployment nao existe como role, comando e evidencia;
- review nao participa do fluxo antes de merge/deploy;
- task passa para done sem acceptance, quality, review e deployment gates;
- current-state afirma PASS sem screenshot/API/log que cubra o requisito.

## 2.4 Cenario E2E Obrigatorio de Produto Pronto

O gate final precisa executar este cenario em storage limpo:

1. Iniciar daemon e web.
2. Abrir UI.
3. Criar uma master task pela UI ou assistant global.
4. Assistant/product/design refinam escopo e aceite.
5. Planning gera pelo menos 6 subtasks em DAG, com duas independentes, uma dependente de duas provides e uma com lock conflitante.
6. Scheduler inicia automaticamente as subtasks runnable.
7. Pelo menos duas subtasks rodam em paralelo.
8. Orchestrator bloqueia a subtask com lock/semaforo indisponivel e explica o motivo.
9. Engineering executa em worktree filho.
10. Quality valida e emite evidencia.
11. Review aprova ou bloqueia com finding persistido.
12. MergeCoordinator mergeia subtasks sequencialmente no parent feature.
13. Deployment executa gate configurado e registra artifact.
14. Board mostra done/deployed com historico completo.
15. Reabrir a aplicacao preserva board, task, chats, eventos, artifacts e status.

Sem esse cenario passando, o produto segue `PRODUCT_NOT_READY`.

## 3. Evidencias Auditadas

| Fonte | Evidencia |
|---|---|
| Spec MVP | `kanban-code-agent-spec-v2.md:1632` a `kanban-code-agent-spec-v2.md:1688` lista criterios de aceite por persistencia, UI, orchestrator, agents, worktrees e master tasks. |
| Agents da spec | `kanban-code-agent-spec-v2.md:667` a `kanban-code-agent-spec-v2.md:719` define assistant, orchestrator e agents de coluna. |
| Orchestrator da spec | `kanban-code-agent-spec-v2.md:955` a `kanban-code-agent-spec-v2.md:1037` exige fila, state machine, interrupcao, locks, semaforos e eventos. |
| DAG/subtasks da spec | `kanban-code-agent-spec-v2.md:1182` a `kanban-code-agent-spec-v2.md:1309` exige subtasks pequenas, needs/provides, locks, agent sugerido, semaforos e diagnostico. |
| Chats UI | `kanban-code-agent-spec-v2.md:1374` a `kanban-code-agent-spec-v2.md:1431` define chat global e chat da task. |
| FSDB atual | `packages/fsdb/src/index.js:120` a `packages/fsdb/src/index.js:154` cria estrutura, runtime e settings. |
| Agents atuais | `packages/fsdb/src/index.js:182` a `packages/fsdb/src/index.js:244` cria defaults de agents. |
| Task storage atual | `packages/fsdb/src/index.js:294` a `packages/fsdb/src/index.js:327` cria `task.yaml`, Markdown, JSONL, dependencies, subtasks e worktree. |
| Orchestrator atual | `packages/orchestrator/src/index.js:161` a `packages/orchestrator/src/index.js:517` concentra commands, run, complete, chat, decompose e merge. |
| Scheduler atual | `packages/orchestrator/src/index.js:66` a `packages/orchestrator/src/index.js:104` calcula `why_not_running`, sem executar fila continua. |
| Assistant Pi/tools | `packages/pi-adapter/src/index.js:64` a `packages/pi-adapter/src/index.js:240` define tools `kca_*`. |
| Assistant real | `packages/pi-adapter/src/index.js:290` a `packages/pi-adapter/src/index.js:341` cria sessao real Pi e injeta tools. |
| Assistant fake | `packages/orchestrator/src/index.js:368` a `packages/orchestrator/src/index.js:436` usa fallback por palavras-chave. |
| Decomposicao atual | `packages/orchestrator/src/index.js:440` a `packages/orchestrator/src/index.js:481` cria subtasks, mas com fluxo simples. |
| Worktree atual | `packages/git-worktree/src/index.js:56` a `packages/git-worktree/src/index.js:130` cria worktree e merge basico. |
| UI atual | `apps/web/src/App.tsx:79` a `apps/web/src/App.tsx:147` envia chat/actions ao daemon. |
| Modal task atual | `apps/web/src/components/TaskModal.tsx:83` a `apps/web/src/components/TaskModal.tsx:141` mostra split 50/50 e abas, com conteudo parcialmente estatico. |
| Daemon atual | `apps/daemon/src/server.js:90` a `apps/daemon/src/server.js:175` expoe poller, HTTP, SSE e WebSocket. |
| Testes permissivos | `tests/unit/orchestrator.test.js:120` a `tests/unit/orchestrator.test.js:168` aceita formatos alternativos do assistant, reduzindo prova de comportamento. |

Nota graphify: `graphify-out/graph.json` nao existe neste checkout; a auditoria usou leitura direta do codigo atual.

## 4. Inventario Granular vs Spec v2 e Objetivo

| Epico | Status | Evidencia atual | Gap para objetivo |
|---|---|---|---|
| FSDB local-first | Feita parcial | `initStorage`, `createTask`, `boardSnapshot`, eventos JSONL | Falta repositorio transacional por agregado, lock real de escrita e schema versionado para roles/DAG/run queue. |
| UI Kanban | Feita parcial | React board, modal e rail conectados ao daemon | Falta representar equipe gerente/produto/design/engenharia/qualidade/review/deployment, editor real de planning/DAG e historico persistente de chats. |
| Assistant global | Parcial | `agent.chat`, Pi tools e fallback fake | Falta contrato deterministico de tool calls, memoria de chat, escopo global completo e validacao forte do comportamento. |
| Assistant da task | Parcial | Modal envia `agent.chat` com `taskId` | Falta contexto isolado persistido, chat por task em FSDB, comandos de tarefa por escopo e recuperacao de conversa. |
| Agents especializados | Parcial | Defaults atuais: assistant, architect, engineer, validator, reviewer, hook-agent | Faltam gerente, produto, design, qualidade e deployment; `architect`/`validator` nao equivalem ao fluxo pedido. |
| Orchestrator deterministico | Parcial | Commands tipados, idempotencia, manual override, merge basico | Falta scheduler continuo, worker queue, autoStart por coluna, semaforos com aquisicao/liberacao, politicas por role e tracing operacional. |
| DAG de subtasks | Parcial | `subtasks.yaml`, `task.decompose`, needs/provides | Falta validacao de grafo, topological scheduling, N subtasks geradas no planning, artefatos esperados e invalidacao do DAG por mudanca manual. |
| Paralelismo | Parcial | `why_not_running` calcula limites e tokens | Falta executor que inicia runnable tasks em paralelo e respeita semaforos de forma atomica. |
| Worktrees | Parcial | `createWorktree`, `mergeSubtask` | Falta parent feature worktree consistente, worktree por projeto alvo, cleanup, diff evidence, merge queue por parent e policy de deployment. |
| Hooks | Parcial | `runHooks`, command/script/noop, eventos | `agent-action` nao executa agent real; hooks nao estao integrados a phase gates de role. |
| Deployment | Nao feita | Nao ha role/coluna/command de deploy | Precisa role `deployment`, release gates, logs, rollback e comandos configuraveis. |
| Testes de comportamento multiagente | Parcial | Unit/E2E cobrem fluxo basico | Faltam testes de scheduler continuo, N subtasks, concorrencia, role handoff, assistant tool-call real e deployment. |

## 5. Avaliacao de Arquitetura, OO, Patterns e SOLID

### Pontos bons

- Separacao inicial em packages: `fsdb`, `orchestrator`, `agent-runtime`, `pi-adapter`, `git-worktree`, `schemas`.
- Daemon funciona como transporte e nao como banco.
- FSDB usa arquivos abertos e escrita atomica.
- Commands e queries passam por Zod.
- Adapter Pi esta isolado do resto do codigo.
- Worktree/Git foi colocado em adapter separado.

### Problemas de arquitetura

| Problema | Evidencia | Impacto | Direcao |
|---|---|---|---|
| God module procedural no orchestrator | `packages/orchestrator/src/index.js` tem commands, hooks, scheduler check, chat, decomposicao, merge e queries no mesmo arquivo | Baixa coesao, dificil testar concorrencia e estender roles | Separar CommandBus, TaskStateMachine, Scheduler, RoleRuntime, MergeCoordinator, HookRunner. |
| Primitive obsession | Roles, colunas, status, eventos, locks e semaforos sao strings soltas | Bugs silenciosos, pouca validacao e regras duplicadas | Criar contratos de dominio e schemas explicitos para Role, ColumnPolicy, Semaphore, DAGNode, AgentRun. |
| State machine incompleta | `complete_task` seta status por `nextColumn`, mas nao aplica hooks before/after nem autoStart | Spec exige transicoes deterministicas e agenda proxima coluna | Implementar `TaskStateMachine.transition(command, context)`. |
| Scheduler apenas diagnostico | `whyNotRunning` calcula motivos, `task.run` e manual | Nao ha execucao paralela autonoma nem semaforo atomico | Criar `Scheduler.tick()` e `SemaphoreStore.acquire/release`. |
| Assistant com dois modos divergentes | Pi real usa tools, fake usa keyword matching | Comportamento depende de ambiente; testes podem passar sem provar tool-call real | Criar `AssistantService` com adapter fake orientado a intents/tool calls, nao regex. |
| Testes relaxados | Teste aceita reply sem action em `agent.chat` | Regressao de comportamento pode passar | Reforcar contrato: outcome esperado deve aparecer no FSDB/eventos. |
| UI com paineis estaticos | Tabs de acceptance, subtasks, eventos, arquivos mostram textos estaticos | Usuario nao consegue operar planning/DAG real no modal | Ligar tabs a arquivos FSDB e commands. |
| Acoplamento FSDB -> init em leitura | Muitas leituras chamam `initStorage` | Leitura tem efeitos colaterais, dificulta diagnostico | Separar `ensureInitialized` de repositorios de leitura. |

### SOLID

| Principio | Status | Achado | Ajuste |
|---|---|---|---|
| SRP | Fraco no orchestrator | Um arquivo concentra muitas responsabilidades | Extrair servicos por caso de uso. |
| OCP | Fraco para roles | Adicionar role exige mexer em defaults, UI, scheduler e prompts | Role registry extensivel por YAML/schema. |
| LSP | Neutro | Pouca OO/heranca no projeto | Usar portas/interfaces, nao heranca. |
| ISP | Parcial | Tools de agents sao amplas e algumas roles recebem tools que nao deveriam | Toolsets por role e por scope. |
| DIP | Parcial | Orchestrator importa adapters concretos diretamente | Injetar ports: TaskRepository, AgentRuntime, WorktreeManager, Clock, EventBus. |

### Patterns recomendados

- Ports and Adapters: FSDB, Pi, Git e transportes como adapters; dominio independente.
- Command Bus: um handler por command.
- State Machine: transicoes de task declaradas e testadas.
- Strategy: comportamento por role e por coluna.
- Repository + Event Store: escrita materializada + eventos append-only.
- Unit of Work/Lock Guard: escrita atomica e semaforos.
- Scheduler Worker: loop deterministico com `tick()`.
- Policy Objects: WIP, semaforos, locks, manual override, autoStart e merge.

## 6. Arquitetura Alvo

### Boundaries propostos

| Pacote | Responsabilidade alvo |
|---|---|
| `packages/core` | Tipos canonicos, role registry, state machine, event names, policies puras, DAG utilities. |
| `packages/schemas` | Zod schemas versionados para settings, roles, tasks, DAG, semaforos, commands e eventos. |
| `packages/fsdb` | Repositorios FSDB: TaskRepository, SettingsRepository, EventStore, RuntimeStore, SemaphoreStore. |
| `packages/orchestrator` | Application services: CommandBus, Scheduler, RoleRouter, HookRunner, MergeCoordinator. |
| `packages/agent-runtime` | Agent sessions, task/global chat sessions, resumable runs, tool dispatcher. |
| `packages/pi-adapter` | Apenas integracao Pi SDK e conversao de tool contracts. |
| `packages/git-worktree` | Git/worktree adapter, status, diff, merge, cleanup. |
| `apps/daemon` | HTTP/SSE/WS/RPC, sem regra de dominio. |
| `apps/web` | UI, forms, visualizacao, optimistic UX controlada. |
| `apps/cli` | Automacao local via command/query contracts. |

### Role registry alvo

| Role | Etapa | Responsabilidades | Tools base | Gate de saida |
|---|---|---|---|---|
| `manager` | Intake/coordination | Priorizar, destravar, atribuir dono, decidir proxima acao | create/update/move/request_input/why_not_running | Task tem prioridade, dono, SLA e escopo de decisao. |
| `product` | Planning/produto | Refinar problema, aceite, valor, edge cases | update_task/emit_artifact/spawn_subtasks/request_input | Acceptance criteria e produto estao claros. |
| `design` | Planning/design | UX, fluxos, estados, componentes e assets | emit_artifact/update_task/request_input | Design spec e impacto UI documentados. |
| `engineering` | Build | Implementar em worktree, emitir diff/evidencia | complete_task/report_blocker/emit_artifact | Codigo e testes locais passam. |
| `quality` | QA | Validar ACs, e2e, regressao, acessibilidade | complete_task/report_blocker/emit_artifact | Evidencia de validacao anexada. |
| `review` | Review | Code review, riscos, merge readiness | complete_task/report_blocker/emit_artifact | Findings resolvidos ou aceitos. |
| `deployment` | Release | Build/release/deploy local configuravel, rollback | complete_task/report_blocker/emit_artifact | Release/deploy registrado ou bloqueado. |

O orchestrator continua nao-LLM. Ele escolhe quando e como iniciar roles, controla concorrencia e aplica transicoes.

## 7. Contratos Novos

### `settings/roles/<role-id>.yaml`

```yaml
schema: kanban-code-agent/role@1
id: engineering
label: Engineering
agentId: engineering
columnIds: [build]
tools:
  custom: [complete_task, report_blocker, emit_artifact]
limits:
  tokens: 2
policies:
  canCreateSubtasks: false
  requiresWorktree: true
  autoStart: true
```

### `tasks/<task-id>/planning.yaml`

```yaml
schema: kanban-code-agent/planning@1
taskId: KCA-200
status: proposed
createdByRole: product
roles:
  required: [product, design, engineering, quality, review, deployment]
  optional: [manager]
artifacts:
  acceptance: acceptance.md
  design: artifacts/design.md
  technicalPlan: plan.md
```

### `tasks/<task-id>/subtasks.yaml`

```yaml
schema: kanban-code-agent/subtasks@2
parentTaskId: KCA-200
strategy: dag
mergePolicy: sequential-into-parent-feature
nodes:
  - id: KCA-200-PRODUCT
    role: product
    title: Refinar aceite
    needs: []
    provides: [contract:product-ready]
    semaphores: [agent:product]
    fileLocks: [tasks/KCA-200/acceptance.md]
  - id: KCA-200-ENG-API
    role: engineering
    title: Implementar API
    needs: [contract:product-ready]
    provides: [service:api-ready]
    semaphores: [agent:engineering, project:kanban-code-agent:tasks]
    fileLocks: [apps/daemon/**, packages/orchestrator/**]
edges:
  - from: KCA-200-PRODUCT
    to: KCA-200-ENG-API
    contract: contract:product-ready
```

### `settings/runtime/semaphores.yaml`

```yaml
schema: kanban-code-agent/semaphores@1
tokens:
  global:tasks: 4
  agent:engineering: 2
  agent:quality: 1
  project:kanban-code-agent:tasks: 2
  parent:KCA-200:merge: 1
leases: []
```

## 8. Plano Executavel

### F0 - Estabilizar baseline e testes

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F0.S1.T1 | Done | senior-engineer | `tests/unit/orchestrator.test.js`, `packages/orchestrator/src/index.js` | `tests/unit/orchestrator.test.js`, `packages/orchestrator/src/index.js` | `agent.chat` tem contrato deterministico em fake e real | `rtk pnpm test:unit` prova task criada/movida/renomeada por evento/estado, nao so reply. |
| F0.S1.T2 | Done | senior-engineer | `packages/pi-adapter/src/index.js`, tests | `package.json`, `tests/unit/pi-adapter.test.js`, `tests/unit/fsdb-cli.test.js` | Pi real nao roda em unit sem flag explicita | `rtk pnpm test:unit` usa `KCA_PI_ADAPTER=fake`; `rtk pnpm test:pi` valida smoke Pi real opt-in. |
| F0.S1.T3 | Done | senior-engineer | `plan-v2.md` | `plan-v2.md` | Auditoria aceita como baseline | Produzido este documento; validado com `rtk pnpm lint`, `rtk pnpm test:unit` e `rtk pnpm test:pi`. |

Gate F0:

- `rtk pnpm lint`
- `rtk pnpm test:unit`
- `rtk node tests/tools-validation.mjs` quando Pi fake/real estiver configurado de modo deterministico.

### F1 - Dominio e contratos extensíveis

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F1.S1.T1 | Done | architect | `packages/core/src/roles.js`, `packages/core/src/contracts.js` | `packages/core/src/roles.js`, `packages/core/src/contracts.js`, `packages/core/package.json` | Role registry canonico contem manager/product/design/engineering/quality/review/deployment | `rtk pnpm test:unit` lista roles e toolsets em fixtures/contracts. |
| F1.S1.T2 | Done | architect | `packages/schemas/src/index.js` | `packages/schemas/src/index.js`, `tests/unit/schemas.test.js` | Schemas `RoleSettings`, `Planning`, `Subtasks@2`, `SemaphoreState`, `AgentRun` existem | `rtk pnpm test:unit` valida schemas gerados pelo FSDB. |
| F1.S1.T3 | Done | engineer | `packages/fsdb/src/index.js` ou novos repositorios | `packages/fsdb/src/index.js`, `packages/fsdb/package.json`, `pnpm-lock.yaml`, `tests/unit/fsdb-cli.test.js` | FSDB cria `settings/roles`, `planning.yaml`, `semaphores.yaml` sem quebrar tasks v1 | `rtk pnpm test:unit` prova init/task create/decompose/recover. |
| F1.S1.T4 | Done | engineer | `packages/test-fixtures/src/index.js` | `packages/test-fixtures/src/index.js`, `tests/unit/contracts-fixtures.test.js` | Fixtures representam board de equipe completa | `rtk pnpm test:unit` usa fixtures v2 de roles, planning e DAG. |

Gate F1:

- `rtk pnpm lint`
- `rtk pnpm test:unit -- --test-name-pattern schema` se runner permitir filtro; senao `rtk pnpm test:unit`.

### F2 - Orchestrator modular, state machine e scheduler

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F2.S1.T1 | Done | architect | `packages/orchestrator/src/state-machine.js` | `packages/orchestrator/src/state-machine.js`, `tests/unit/scheduler.test.js` | Transicoes de task saem de tabela/funcao pura | `rtk pnpm test:unit` cobre idle->queued->running, complete, blocked, merge_pending, manual override. |
| F2.S1.T2 | Pending | engineer | `packages/orchestrator/src/command-bus.js` | - | Um handler por command, sem god function | Tests atuais passam sem regressao. |
| F2.S1.T3 | Done | engineer | `packages/orchestrator/src/scheduler.js` | `packages/orchestrator/src/scheduler.js`, `packages/orchestrator/src/index.js`, `packages/core/src/contracts.js`, `packages/schemas/src/index.js`, `tests/unit/scheduler.test.js`, `tests/unit/contracts-fixtures.test.js` | `Scheduler.tick()` encontra runnable tasks e inicia ate limites | `rtk pnpm test:unit` cria tasks queued e prova duas iniciadas com tokens/semaforos. |
| F2.S1.T4 | Done | engineer | `packages/fsdb/src/runtime-store.js` | `packages/fsdb/src/runtime-store.js`, `packages/fsdb/package.json`, `tests/unit/scheduler.test.js` | Semaforos possuem acquire/release atomico com leaseId/runId | `rtk pnpm test:unit` simula contencao e release. |
| F2.S1.T5 | Done | engineer | `apps/daemon/src/server.js` | `apps/daemon/src/server.js`, `tests/e2e/kanban.spec.js`, `packages/fsdb/src/index.js`, `packages/fsdb/src/runtime-store.js` | Daemon roda scheduler loop configuravel e publica eventos | `rtk pnpm test:e2e` prova task queued saindo para running via scheduler autonomo. |

Gate F2:

- `rtk pnpm test:unit`
- `rtk pnpm lint`
- `rtk pnpm test:pi`
- `rtk pnpm test:e2e`
- teste unitario de concorrencia com tasks queued, maxStarts 2, agent tokens 2 e semaforos; E2E prova loop autonomo do daemon.

### F3 - Runtime de agents, scopes de chat e roles

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F3.S1.T1 | Done | engineer | `packages/agent-runtime/src/index.js` | `packages/agent-runtime/src/index.js`, `tests/unit/orchestrator.test.js` | `startRun` recebe role, scope, task context e toolset filtrado | `rtk pnpm test:unit` valida `agent.run` com role, scope, allowedTools e promptHash. |
| F3.S1.T2 | Done | engineer | `packages/pi-adapter/src/index.js` | `packages/pi-adapter/src/index.js`, `tests/unit/pi-adapter.test.js` | Pi adapter recebe contracts de tools, sem conhecer FSDB direto | `rtk pnpm test:unit` e `rtk pnpm test:pi` provam tools chamadas e efeitos persistidos via context mockado. |
| F3.S1.T3 | Done | engineer | `packages/fsdb/src/chat-store.js` | `packages/fsdb/src/chat-store.js`, `packages/orchestrator/src/index.js`, `apps/web/src/App.tsx`, `apps/web/src/components/TaskModal.tsx` | Chats global/task persistem em JSONL ou Markdown resumido | `rtk pnpm test:e2e` recarrega pagina e historico global/task continua. |
| F3.S1.T4 | Done | product/design/engineering | `settings/prompts/*.md`, `settings/roles/*.yaml` defaults | `packages/core/src/roles.js`, `packages/fsdb/src/index.js`, `packages/schemas/src/index.js`, `tests/unit/schemas.test.js` | Cada role tem prompt, escopo, tools e policies proprias | `rtk pnpm test:unit` valida roles default com scope, promptPath, tools e policies. |
| F3.S1.T5 | Done | quality | `tests/unit/orchestrator.test.js`, `tests/e2e/kanban.spec.js` | `tests/unit/orchestrator.test.js`, `tests/e2e/kanban.spec.js`, `tests/unit/contracts-fixtures.test.js` | Assistant global e task assistant executam actions por scope correto | Tests cobrem criar global, explicar task, alterar acceptance, decompor e persistir historico por scope. |

Gate F3:

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
- `rtk pnpm lint`
- `rtk pnpm test:pi`
- Smoke Pi real opcional: `rtk pnpm --filter @kca/cli exec kca doctor --pi-smoke` com credenciais locais.

### F4 - Planning e DAG de N subtasks

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F4.S1.T1 | Pending | product | `packages/orchestrator/src/planning-service.js` | - | Planning cria `planning.yaml`, acceptance e proposta de roles | Unit test cria master task e planning artifacts. |
| F4.S1.T2 | Pending | architect | `packages/core/src/dag.js` | - | DAG valida ciclos, missing contracts, duplicate provides e locks | Unit tests de grafo valido/invalido. |
| F4.S1.T3 | Pending | engineer | `packages/orchestrator/src/decompose-command.js` | - | `spawn_subtasks` aceita N nodes e persiste `subtasks@2` | Teste com 6 subtasks e DAG parcial. |
| F4.S1.T4 | Pending | engineer | `packages/orchestrator/src/scheduler.js` | - | Scheduler executa subtasks prontas em paralelo e bloqueia dependentes | Evidence: runs simultaneos ate limite e reasons para bloqueadas. |
| F4.S1.T5 | Pending | design/engineer | `apps/web/src/components/TaskModal.tsx` ou novos componentes | - | Aba Subtasks mostra DAG simples dentro da task, sem tela DAG dedicada | Playwright screenshot e interacao basica. |

Gate F4:

- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
- Caso manual/API: master com N=6, maxParallel=3, duas subtasks com lock conflitante, uma dependente de duas provides.

### F5 - Worktrees, review e deployment

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F5.S1.T1 | Pending | engineer | `packages/git-worktree/src/index.js` | - | Parent feature worktree criado antes das subtasks | Git fixture valida branch parent e child. |
| F5.S1.T2 | Pending | engineer | `packages/orchestrator/src/merge-coordinator.js` | - | Merge queue por parent usa semaforo `parent:<id>:merge` | Unit test prova merge sequencial real. |
| F5.S1.T3 | Pending | review | `settings/roles/review.yaml`, prompts/tests | - | Review role recebe diff/status/evidence e decide bloqueio ou merge_ready | Unit test com finding bloqueante. |
| F5.S1.T4 | Pending | deployment | `settings/roles/deployment.yaml`, `packages/orchestrator/src/deployment-service.js` | - | Deployment executa comandos configurados, registra release e rollback info | Teste command fake e artifact de deploy. |
| F5.S1.T5 | Pending | quality | `tests/unit/git-worktree.test.js`, e2e | - | Conflito move task para blocked com evidencia | Fixture Git com conflito real. |

Gate F5:

- `rtk pnpm test:unit`
- Git fixture: parent feature + 3 subtasks + merge sequencial + conflito.

### F6 - UI de equipe multiagente

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F6.S1.T1 | Pending | design | `apps/web/src/types.ts`, componentes de board | - | Cards mostram role atual, role anterior, proximo gate e parallel status | Screenshot desktop/mobile. |
| F6.S1.T2 | Pending | engineer | `apps/web/src/components/TaskModal.tsx` ou componentes novos | - | Abas acceptance/planning/subtasks/events/files leem e escrevem dados reais | E2E edita acceptance e ve evento. |
| F6.S1.T3 | Pending | engineer | `apps/web/src/components/AssistantPanel.tsx` | - | Chat global persiste, mostra tool outcomes e tem scope global | E2E recarrega e historico permanece. |
| F6.S1.T4 | Pending | engineer | task chat components | - | Chat da task persiste, usa task context e pode alterar task mediante command | E2E conversa no modal e verifica FSDB. |
| F6.S1.T5 | Pending | engineer | `apps/web/src/components/OrchestratorPanel.tsx` | - | Painel mostra semaforos, leases, runnable queue, role tokens e merge queue | E2E/visual evidence. |

Gate F6:

- `rtk pnpm lint`
- `rtk pnpm test:e2e`
- Screenshot 1920x1080 e mobile com board, task modal e orchestrator.

### F7 - Auditoria, observabilidade e current-state

| ID | Status | Owner | Planned files | Actual files | Done when | Evidencia requerida |
|---|---|---|---|---|---|---|
| F7.S1.T1 | Pending | quality | `current_state/kanban-code-agent/feature-parity-spec-v2.md` | - | Auditoria AC-by-AC atualizada sem overclaim | Documento cita comando/evidencia por AC. |
| F7.S1.T2 | Pending | quality | `current_state/kanban-code-agent/catalog.md` | - | Catalogo runtime cobre roles, DAG, semaforos, chats e deploy | Screenshots/API artifacts. |
| F7.S1.T3 | Pending | quality | tests/evidence scripts | - | Validacao completa roda com storage limpo | `lint`, `build`, `unit`, `e2e`, runtime probes. |
| F7.S1.T4 | Pending | manager | `.changelog/...` quando houver implementacao | - | Mudancas de codigo registradas | Changelog por feature implementada. |

Gate F7:

- `rtk pnpm lint`
- `rtk pnpm build`
- `rtk pnpm test:unit`
- `rtk pnpm test:e2e`
- runtime validation com storage temporario limpo.

## 9. Matriz de AC e Validacao

| Requisito | Status atual | Tasks que fecham | Validacao final |
|---|---|---|---|
| FSDB como banco | Parcial | F1.S1.T3, F2.S1.T4 | Inspecao de storage + unit FSDB. |
| Equipe gerente/produto/design/engenharia/qualidade/review/deployment | Nao feita | F1.S1.T1, F3.S1.T4, F6.S1.T1 | Settings roles + UI + tests por role. |
| Assistants global e task scope | Parcial | F3.S1.T3, F6.S1.T3, F6.S1.T4 | E2E recarregando chats e provando commands por scope. |
| Planning cria N subtasks | Parcial | F4.S1.T1, F4.S1.T3 | Unit com N=6 e FSDB `subtasks@2`. |
| DAG paralelizavel | Parcial | F4.S1.T2, F4.S1.T4 | Teste topologico com dependencias e locks. |
| Controle por semaforo no orchestrator | Parcial | F2.S1.T3, F2.S1.T4 | Teste de acquire/release e runnable queue. |
| Operacao paralela de roles | Nao feita | F2.S1.T3, F3.S1.T1, F4.S1.T4 | Runs simultaneos ate limite, status no painel. |
| Review e deployment | Nao feita | F5.S1.T3, F5.S1.T4 | Role gates, artifacts e commands fake/real. |
| Arquitetura extensivel/SOLID | Parcial | F1, F2 | Orchestrator modular e tests por service. |

## 10. Riscos

| Severidade | Risco | Impacto | Mitigacao |
|---|---|---|---|
| Alta | Rodar Pi real em unit/e2e por padrao | Flakiness, custo, dependencia externa | Fake deterministic default e smoke real separado. |
| Alta | Semaforos sem escrita atomica | Duas tasks podem adquirir o mesmo recurso | Lease file atomico com expiracao e release por run. |
| Alta | Merge em parent errado | Corrupcao de branch | Validar metadata parent/child antes de merge. |
| Media | Refactor grande do orchestrator quebrar MVP | Regressao de commands existentes | Migrar por strangler pattern: handlers novos por command mantendo facade. |
| Media | UI expor DAG complexo demais | Produto vira tela tecnica | Mostrar DAG simples dentro da task, conforme spec, com detalhes progressivos. |
| Media | Overclaim em docs | Planejamento errado | Current-state deve registrar evidencia por requisito. |

## 11. Rollback e Estrategia de Migracao

- Manter `handleCommand` como facade publica durante a migracao.
- Extrair handlers um por vez, preservando schemas de command existentes.
- Adicionar schemas v2 sem remover leitura v1.
- Migrar defaults de agents para roles sem apagar agents antigos; criar alias `architect -> product/planning` apenas se necessario.
- Executar testes a cada fase.
- Para falha em F2/F3, rollback por commit/patch mantendo FSDB v1 intacto.

## 12. Ordem Recomendada de Execucao

1. F0: tornar testes determinísticos e impedir overclaim.
2. F1: criar dominio/contratos de roles, planning, DAG e semaforos.
3. F2: separar orchestrator e implementar scheduler/leases.
4. F3: persistir chats e padronizar runtime de roles.
5. F4: implementar planning com N subtasks em DAG.
6. F5: fechar worktree, review e deployment.
7. F6: ligar UI aos dados reais.
8. F7: validar e atualizar current-state.

## 13. Criterio de Done do Objetivo

O objetivo so deve ser marcado como completo quando houver evidencia de:

- storage limpo inicializando roles de gerente, produto, design, engenharia, qualidade, review e deployment;
- board exibindo e roteando tasks por esses papeis;
- assistant global criando/alterando/explicando tasks com eventos persistidos;
- assistant da task operando com contexto isolado e historico persistente;
- planning criando N subtasks em DAG valido;
- scheduler iniciando subtasks prontas em paralelo com semaforos e locks;
- worktrees filhos nascendo do parent feature;
- merge sequencial no parent e role de deployment executando gate configurado;
- testes unitarios/e2e e current-state provando os fluxos acima.

Este criterio e subordinado as clausulas C1-C15 e ao cenario E2E obrigatorio. Se houver conflito entre um teste menor e as clausulas de produto pronto, as clausulas vencem.

## 14. Validacao Desta Auditoria

| Comando | Resultado | Observacao |
|---|---|---|
| `rtk pnpm lint` | Passou | Typecheck web e `node --check` dos pacotes atuais. |
| `rtk pnpm test:unit` | Passou, 28/28, 2 skips Pi real | Unit agora roda com `KCA_PI_ADAPTER=fake`; testes de assistant ficaram estritos e rapidos. |
| `rtk pnpm test:pi` | Passou, 4/4 | Smoke opt-in valida SDK Pi real e doctor sem rodar em unit padrao. |
| F1 validation | Passou | `rtk pnpm lint`, `rtk pnpm test:unit`, `rtk pnpm test:pi` apos roles/schemas/FSDB defaults. |
| Inspecao de worktree | Passou | `plan-v2.md` criado; `.memory/TODO.md` atualizado com pendencia v2. |
