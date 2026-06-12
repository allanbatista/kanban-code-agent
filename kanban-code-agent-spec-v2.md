# Kanban Code Agent — Product & Technical Spec

**Versão:** 0.2 revisada  
**Data:** 2026-06-11  
**Stack alvo:** Node.js monorepo + Vite + daemon local + Pi SDK  
**Princípio central:** local-first, filesystem-as-database, open formats, agent-readable, UI minimalista.

---

## 0. Resumo da revisão

Esta versão revisa a spec e o mock para alinhar o produto ao prompt original e às decisões posteriores de UI.

Mudanças principais desta revisão:

1. Remove o conceito de **projeto ativo global**. A task decide quais repositórios/projetos serão alterados.
2. Mantém a UI minimalista: topbar simples, board sem wrapper pesado e colunas sem descrições longas no header.
3. Remove qualquer tela/botão dedicado de DAG. Dependências aparecem apenas como detalhe contextual dentro da task/master task.
4. Remove botões operacionais ambíguos como “filesystem” e “rodar prontas”. Ações avançadas devem partir do assistant, do modal da task ou do orchestrator.
5. Garante que configurações são editáveis pela UI em um modal grande, com árvore por escopo à esquerda e conteúdo editável à direita.
6. Mantém filesystem-as-database como requisito central, mas separa dados versionáveis de runtime/sessões não versionáveis.
7. Define melhor o papel do orchestrator: determinístico, responsável por transições, filas, interrupção, locks, worktrees, hooks e merge.
8. Define melhor a relação entre Pi SDK, skills, tools customizadas, sessão por task e retomada.
9. Explicita o fluxo de task master → subtasks paralelas → worktrees filhos → merge sequencial no worktree da feature parent.

---

## 1. Visão

O Kanban Code Agent é uma aplicação local-first para coordenar desenvolvimento de software usando um Kanban operado por humanos e agents.

A aplicação deve permitir que um usuário descreva uma demanda, transforme essa demanda em uma ou mais tasks, delegue etapas para agents especializados e acompanhe execução, bloqueios, evidências, worktrees e merges de forma simples.

O produto não deve tentar esconder o projeto dos agents. Pelo contrário: todos os dados relevantes devem ser legíveis, versionáveis quando apropriado e armazenados em formatos abertos, para que qualquer agent consiga entender o estado do board sem depender de um banco proprietário.

A UI deve ser minimalista e progressiva:

- o board mostra apenas o necessário;
- o chat principal gerencia o Kanban e explica decisões;
- o modal da task concentra configuração, execução, worktree, dependências e chat interno;
- configurações avançadas ficam em um modal dedicado por escopo.

---

## 2. Objetivos

1. Criar uma aplicação local-first com dados principais em filesystem.
2. Usar formatos abertos e agent-readable: YAML, Markdown, JSONL e artefatos textuais.
3. Usar Node.js monorepo com Vite para a interface.
4. Usar um daemon local para validar comandos, persistir dados, assistir arquivos e orquestrar agents.
5. Usar Pi SDK como runtime/SDK de agents, encapsulado por um adapter interno.
6. Permitir múltiplos projetos/repositórios cadastrados.
7. Fazer cada task declarar seus projetos/repositórios alvo.
8. Criar uma sessão dedicada de agent por task e por etapa quando necessário.
9. Permitir retomar sessões de agent sem versionar o conteúdo bruto dessas sessões.
10. Criar worktree dedicado por task executável.
11. Permitir task master com subtasks paralelizáveis.
12. Usar needs/provides, file locks e semáforos para controlar paralelismo.
13. Permitir hooks por coluna e por escopo, disparando actions/agents pré-configurados.
14. Permitir customizar agents, instruções, tools, skills e permissões pela UI.
15. Manter o fluxo claro quando uma task muda de coluna por decisão do agent ou por ação manual do usuário.

---

## 3. Não objetivos do MVP

1. Backend cloud multiusuário.
2. Banco relacional obrigatório.
3. Sincronização remota nativa.
4. Permissão avançada por usuário/time.
5. Execução distribuída em múltiplas máquinas.
6. Resolução automática de conflitos complexos de merge sem intervenção.
7. Tela DAG dedicada.
8. Sistema visual complexo de pipelines. O Kanban continua sendo a metáfora principal.
9. Edição direta de arquivos pela UI sem passar pelo daemon.

---

## 4. Princípios de produto

### 4.1 Local-first

A aplicação deve funcionar localmente, com dados salvos no diretório do usuário. Integrações remotas podem existir no futuro, mas não são requisito do MVP.

### 4.2 Filesystem como banco de dados

O filesystem é a fonte primária de verdade. O daemon pode manter índices em memória ou arquivos derivados, mas eles devem ser reconstruíveis.

### 4.3 Formatos abertos

Cada parte importante do sistema precisa poder ser lida por humanos e agents:

- YAML para estado estruturado;
- Markdown para contexto, instruções, planos, critérios e resumos;
- JSONL para eventos append-only;
- arquivos comuns para artefatos, patches, evidências e logs resumidos.

### 4.4 Consistência determinística

Agents podem sugerir decisões, mas o orchestrator aplica regras. Um agent não deve alterar diretamente `task.yaml` para mover coluna. Ele deve chamar uma tool tipada.

### 4.5 Usuário soberano

Movimento manual de task sempre vence. Se um agent estiver rodando, o orchestrator deve interromper, solicitar checkpoint ou descartar resultado tardio conforme política configurada.

### 4.6 Complexidade por disclosure progressivo

A UI não deve expor tudo ao mesmo tempo. O board precisa continuar simples. Detalhes aparecem no modal da task, no chat e no painel de orchestrator.

---

## 5. Arquitetura geral

```txt
apps/web  <── RPC/WebSocket ──>  apps/daemon
                                     │
                                     ├─ packages/fsdb
                                     ├─ packages/orchestrator
                                     ├─ packages/pi-adapter
                                     ├─ packages/git-worktree
                                     ├─ packages/agent-runtime
                                     └─ packages/schemas
```

### 5.1 `apps/web`

Interface Vite. Pode começar como HTML/React simples, evoluindo para componentes reutilizáveis.

Responsabilidades:

- renderizar board;
- renderizar chat principal;
- renderizar modal da task;
- renderizar modal de configurações;
- enviar comandos ao daemon;
- receber eventos em tempo real;
- nunca editar arquivos diretamente.

### 5.2 `apps/daemon`

Serviço local Node.js.

Responsabilidades:

- carregar settings;
- validar schemas;
- executar comandos;
- escrever arquivos de forma atômica;
- assistir filesystem;
- publicar eventos para a UI;
- iniciar/interromper sessions de agent;
- controlar scheduler, locks, semáforos, worktrees e hooks.

### 5.3 `apps/cli`

CLI para automações e debug.

Exemplos:

```bash
kca init
kca project add --id kanban-code-agent --repo ~/Workspaces/kanban-code-agent
kca task create --title "Implementar FSDB"
kca task move KCA-101 build
kca task run KCA-101
kca task interrupt KCA-101 --mode hard
kca task decompose KCA-200
kca doctor
```

---

## 6. Monorepo proposto

```txt
kanban-code-agent/
  package.json
  pnpm-workspace.yaml
  turbo.json
  apps/
    web/
      index.html
      src/
    daemon/
      src/
    cli/
      src/
  packages/
    core/                 # tipos, comandos, eventos, helpers puros
    schemas/              # zod/json-schema para YAML e eventos
    fsdb/                 # leitura/escrita atômica, índices, watcher
    config/               # loaders de settings por escopo
    orchestrator/         # scheduler, state machine, hooks
    agent-runtime/        # RunManager, sessions, tool registry
    pi-adapter/           # integração isolada com Pi SDK
    git-worktree/         # git worktree, branch, merge, diff, checks
    ui-kit/               # componentes compartilhados
    test-fixtures/        # boards, tasks e repos sintéticos
```

### 6.1 Scripts base

```json
{
  "scripts": {
    "dev": "turbo dev",
    "dev:web": "pnpm --filter @kca/web dev",
    "dev:daemon": "pnpm --filter @kca/daemon dev",
    "build": "turbo build",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "turbo lint"
  }
}
```

---

## 7. Estrutura de armazenamento

Diretório padrão:

```txt
~/.kanban-code-agent/
  settings/
    app.yaml
    boards/
      default.yaml
    projects/
      <project-id>.yaml
    agents/
      assistant.yaml
      architect.yaml
      engineer.yaml
      validator.yaml
      reviewer.yaml
      hook-agent.yaml
    prompts/
      assistant-board.md
      decompose-master.md
      implement-task.md
      validate-task.md
      summarize-blocker.md
    hooks/
      normalize-description.yaml
      suggest-subtasks.yaml
      ensure-worktree.yaml
      run-checks.yaml
      summarize-blocker.yaml
      archive-session.yaml
    skills/
      git-worktree/
        SKILL.md
      testing/
        SKILL.md
      spec-writing/
        SKILL.md
      ui-review/
        SKILL.md
    runtime/
      sessions/             # não versionado por padrão
      locks/                # não versionado; reconstruível
      indexes/              # derivado; reconstruível
      logs/                 # não versionado por padrão
      tmp/                  # não versionado
  tasks/
    <task-id>/
      task.yaml
      description.md
      acceptance.md
      plan.md
      dependencies.yaml
      subtasks.yaml
      worktree.yaml
      comments.jsonl
      events.jsonl
      artifacts/
      patches/
      evidence/
      summaries/
        latest.md
        blocker.md
        run-<run-id>.md
      .gitignore
```

### 7.1 Por que `tasks/<task-id>` em vez de `tasks/<project-id>/<task-id>`

A task pode afetar múltiplos projetos. Por isso, a estrutura canônica não deve assumir um único projeto pai. O vínculo com repositórios fica em `task.yaml`:

```yaml
projectTargets:
  - kanban-code-agent
  - docs
```

Se futuramente houver muitos boards, pode ser usado:

```txt
tasks/<board-id>/<task-id>/
```

Mas o MVP pode manter `tasks/<task-id>/` para simplificar.

### 7.2 Dados versionáveis

Devem ser versionáveis por padrão:

```txt
settings/**/*.yaml
settings/**/*.md
settings/skills/**/SKILL.md
tasks/**/task.yaml
tasks/**/description.md
tasks/**/acceptance.md
tasks/**/plan.md
tasks/**/dependencies.yaml
tasks/**/subtasks.yaml
tasks/**/worktree.yaml
tasks/**/comments.jsonl
tasks/**/events.jsonl
tasks/**/artifacts/**
tasks/**/patches/**
tasks/**/evidence/**
tasks/**/summaries/**
```

### 7.3 Dados não versionáveis por padrão

```txt
settings/runtime/sessions/**
settings/runtime/locks/**
settings/runtime/indexes/**
settings/runtime/logs/**
settings/runtime/tmp/**
worktrees físicos
credenciais
tokens
caches
dependências instaladas
```

### 7.4 `.gitignore` sugerido

```gitignore
settings/runtime/sessions/
settings/runtime/locks/
settings/runtime/indexes/
settings/runtime/logs/
settings/runtime/tmp/
**/.kca-cache/
**/.env
**/.env.*
_worktrees/
node_modules/
```

---

## 8. Modelo de dados da task

### 8.1 `task.yaml`

```yaml
schema: kanban-code-agent/task@1
id: KCA-101
title: Modelar banco em arquivos abertos
kind: task # task | master | subtask | spike | bug | chore
column: definition
status: running # idle | queued | running | interrupting | validating | blocked | merge_pending | done | failed | canceled
priority: high
createdAt: 2026-06-11T19:40:00-03:00
updatedAt: 2026-06-11T19:55:00-03:00
createdBy: user
owner: Produto

projectTargets:
  - kanban-code-agent

routing:
  currentAgent: architect
  lastAgent: assistant
  nextSuggestedColumn: build
  manualOverride:
    active: false
    lastManualMoveAt: null
    invalidatesRunId: null

agent:
  currentRunId: run_01HX
  currentSessionRef: settings/runtime/sessions/KCA-101/architect/session.jsonl
  resumeMode: continue
  lastSummary: summaries/run-run_01HX.md

worktree:
  enabled: true
  kind: task
  branch: kca/KCA-101
  pathRef: worktree.yaml
  parentTaskId: null
  mergeTarget: main

dependencies:
  needs: []
  provides:
    - schema:task
    - contract:fsdb
  blockedBy: []
  fileLocks:
    - packages/schemas/**
  semaphores:
    - agent:architect

hooks:
  active:
    - normalize-description
    - suggest-subtasks

skills:
  active:
    - spec-writing
    - git-worktree

tags:
  - local-first
  - fsdb
```

### 8.2 `description.md`

```md
# Modelar banco em arquivos abertos

## Problema

O sistema precisa ser compreensível para humanos e agents sem depender de um banco proprietário.

## Contexto

Todos os dados principais devem ficar em YAML, Markdown e JSONL. Sessões brutas de agents não precisam ser versionadas, mas devem ser retomáveis.

## Decisões relevantes

- Task decide seus projetos alvo.
- Orchestrator é a única camada que aplica transições.
- Eventos são append-only.
```

### 8.3 `acceptance.md`

```md
# Critérios de aceite

- [ ] A estrutura de arquivos consegue representar settings, board, agents, hooks e tasks.
- [ ] O estado atual da task está em YAML.
- [ ] O histórico está em JSONL append-only.
- [ ] O contexto humano/agent-readable está em Markdown.
- [ ] O runtime não versionável consegue guardar ponteiro de sessão para retomada.
```

### 8.4 `dependencies.yaml`

```yaml
schema: kanban-code-agent/dependencies@1
needs:
  - contract:board
provides:
  - schema:task
  - contract:fsdb
blockedBy: []
fileLocks:
  - packages/schemas/**
  - packages/fsdb/**
semaphores:
  - name: agent:architect
    tokens: 1
```

### 8.5 `events.jsonl`

```jsonl
{"ts":"2026-06-11T19:40:00-03:00","type":"task.created","actor":"user","taskId":"KCA-101"}
{"ts":"2026-06-11T19:43:12-03:00","type":"task.moved","actor":"user","taskId":"KCA-101","from":"inbox","to":"definition"}
{"ts":"2026-06-11T19:48:31-03:00","type":"agent.started","actor":"orchestrator","taskId":"KCA-101","agent":"architect","runId":"run_01HX"}
{"ts":"2026-06-11T20:05:45-03:00","type":"agent.completed","actor":"agent","taskId":"KCA-101","runId":"run_01HX","nextColumn":"build","summaryPath":"summaries/run-run_01HX.md"}
```

### 8.6 Regra de reconstrução

`task.yaml` é a visão materializada. `events.jsonl` é o histórico. Em caso de inconsistência:

1. o daemon valida `task.yaml`;
2. se houver divergência, lê `events.jsonl`;
3. reconstrói estado materializado;
4. grava evento `task.recovered`;
5. notifica o usuário no painel de orchestrator.

---

## 9. Settings por escopo

Configurações devem ser editáveis pelo site, mas a UI não precisa expor caminhos físicos. O usuário vê escopos conceituais.

Escopos:

1. Workspace
2. Interface
3. Persistência
4. Board
5. Colunas
6. Hooks por coluna
7. Agents
8. Skills
9. Tools
10. Concorrência
11. Worktrees
12. Sessões
13. Repositórios
14. Permissões

### 9.1 `settings/app.yaml`

```yaml
schema: kanban-code-agent/app@1
storageRoot: ~/.kanban-code-agent
runtimeRoot: ~/.kanban-code-agent/settings/runtime

workspace:
  name: Kanban Code Agent
  language: pt-BR

persistence:
  taskStateFormat: yaml
  contextFormat: markdown
  eventsFormat: jsonl
  versionTaskData: true
  versionRuntimeSessions: false

runtime:
  maxParallelTasks: 4
  maxParallelAgents: 4
  maxParallelMerges: 1
  agentSessionRetentionDays: 30
  resumeSessions: true

manualMove:
  confirmWhenRunning: true
  defaultInterruptPolicy: ask # ask | soft | hard

ui:
  theme: system
  density: comfortable
  showProgressOnCard: true
  showAgentOnCard: true
  showProjectTargetsOnCard: true
  showDependencyBadgesOnCard: true

safety:
  requireApprovalForMerge: true
  requireApprovalForDelete: true
  allowShell: true
  allowNetwork: false
```

### 9.2 `settings/projects/<project-id>.yaml`

```yaml
schema: kanban-code-agent/project@1
id: kanban-code-agent
name: Kanban Code Agent
repoPath: ~/Workspaces/kanban-code-agent
defaultBranch: main

commands:
  install: pnpm install
  dev: pnpm dev
  test: pnpm test
  lint: pnpm lint
  typecheck: pnpm typecheck

worktrees:
  root: ~/.kanban-code-agent/settings/runtime/worktrees/kanban-code-agent
  branchPrefix: kca/
  cleanup: manual

concurrency:
  maxTasks: 2
  maxMerges: 1

trust:
  allowShell: true
  allowNetwork: false
```

### 9.3 `settings/boards/default.yaml`

```yaml
schema: kanban-code-agent/board@1
id: default
name: Default Engineering Flow

columns:
  - id: inbox
    label: Entrada
    agent: null
    autoStart: false
    wipLimit: null
    hooks:
      onEnter: []
      beforeLeave: []
      onAgentComplete: []

  - id: definition
    label: Definição
    agent: architect
    autoStart: true
    wipLimit: 4
    hooks:
      onEnter:
        - normalize-description
      onAgentComplete:
        - suggest-subtasks

  - id: build
    label: Construção
    agent: engineer
    autoStart: true
    wipLimit: 4
    hooks:
      onEnter:
        - ensure-worktree
      beforeLeave:
        - collect-diff-summary

  - id: validate
    label: Validação
    agent: validator
    autoStart: true
    wipLimit: 2
    hooks:
      onEnter:
        - run-checks
      onAgentComplete:
        - summarize-evidence

  - id: blocked
    label: Bloqueado
    agent: null
    autoStart: false
    wipLimit: null
    hooks:
      onEnter:
        - summarize-blocker

  - id: closed
    label: Encerrado
    agent: null
    autoStart: false
    wipLimit: null
    hooks:
      onEnter:
        - archive-session
```

---

## 10. Agents

### 10.1 Tipos

#### Assistant principal da interface

Agent conversacional do board. Ele pode:

- criar tasks;
- editar tasks;
- mover tasks mediante comando confirmado;
- explicar fila e bloqueios;
- decompor master tasks;
- sugerir próxima ação;
- ajustar settings quando autorizado;
- chamar tools do orchestrator.

#### Orchestrator

Serviço determinístico. Não é um LLM.

Responsabilidades:

- validar comandos;
- controlar transições;
- iniciar/interromper agents;
- aplicar hooks;
- criar worktrees;
- controlar semáforos;
- controlar locks;
- coordenar merge;
- registrar eventos.

#### Agents de coluna

Agents configurados por etapa do fluxo:

- architect;
- engineer;
- validator;
- reviewer;
- hook-agent.

#### Hook agents

Agents curtos, com prompt específico e timeout baixo. São usados para ações como:

- normalizar descrição;
- sugerir subtasks;
- resumir bloqueio;
- coletar diff;
- gerar evidência;
- arquivar resumo de sessão.

### 10.2 `settings/agents/engineer.yaml`

```yaml
schema: kanban-code-agent/agent@1
id: engineer
label: Engineer
provider: pi-sdk
model: default
thinkingLevel: medium

instructions:
  file: settings/prompts/implement-task.md
  extra: |
    Trabalhe apenas no worktree da task.
    Não mova a task editando task.yaml diretamente.
    Para finalizar uma etapa, use complete_task.
    Se precisar de informação humana, use request_user_input.

skills:
  - git-worktree
  - testing
  - project-context

tools:
  builtin:
    - read
    - write
    - edit
    - bash
    - grep
    - find
    - ls
  custom:
    - complete_task
    - request_user_input
    - report_blocker
    - emit_artifact
    - spawn_subtasks

limits:
  maxTurns: 40
  idleTimeoutMs: 300000
  hardTimeoutMs: 7200000

permissions:
  allowShell: true
  allowNetwork: false
  requireApprovalForMerge: true
```

---

## 11. Integração com Pi SDK

A integração com Pi deve ficar isolada em `packages/pi-adapter`. O restante do sistema não deve depender diretamente de detalhes de API, nomes de classes ou estrutura interna do SDK.

### 11.1 Estratégia

1. Usar o pacote `@earendil-works/pi-coding-agent` como dependência do adapter.
2. Criar uma sessão por task/agent/run.
3. Passar o `cwd` da sessão como o worktree da task.
4. Injetar instruções do agent e contexto da task no prompt inicial.
5. Carregar skills globais, de projeto e de agent.
6. Registrar ou disponibilizar tools customizadas do Kanban.
7. Capturar stream de eventos para atualizar UI e `events.jsonl`.
8. Persistir ponteiros de sessão em runtime não versionável.
9. Interromper execução quando o usuário mover manualmente uma task running.
10. Validar a versão concreta do SDK no adapter, não espalhar suposições pelo app.

### 11.2 SDK direto vs RPC

Para uma aplicação Node/TypeScript, a preferência é usar o SDK diretamente via `AgentSession`/`createAgentSession`. O modo RPC pode ser mantido como fallback ou modo alternativo para isolamento por subprocesso.

### 11.3 Pseudocódigo conceitual

```ts
export async function startTaskAgent(input: StartTaskAgentInput) {
  const authStorage = await loadAuthStorage(input.authProfile);
  const modelRegistry = await createModelRegistry(authStorage);
  const sessionManager = await createSessionManager({
    sessionDir: input.sessionDir,
    resume: input.resume,
  });

  const { session } = await createAgentSession({
    cwd: input.worktreePath,
    authStorage,
    modelRegistry,
    sessionManager,
    // o adapter monta options compatíveis com a versão concreta do SDK
  });

  const unsubscribe = session.subscribe((event) => {
    input.eventBus.emit("pi.event", normalizePiEvent(event));
  });

  await registerKanbanTools(session, input.customTools);
  await loadKanbanSkills(session, input.skills);
  await session.prompt(renderTaskPrompt(input));

  unsubscribe();
}
```

Este pseudocódigo é intencionalmente conceitual. A implementação final deve acompanhar a versão instalada do SDK.

### 11.4 Tools customizadas obrigatórias

#### `complete_task`

```ts
type CompleteTaskInput = {
  taskId: string;
  runId: string;
  nextColumnId: string;
  disposition: "done" | "blocked" | "needs_review" | "merge_pending" | "canceled";
  summary: string;
  evidence?: string[];
  artifacts?: string[];
  confidence?: "low" | "medium" | "high";
};
```

#### `request_user_input`

```ts
type RequestUserInputInput = {
  taskId: string;
  runId: string;
  question: string;
  suggestedColumn?: "blocked";
  contextFiles?: string[];
  options?: string[];
};
```

#### `report_blocker`

```ts
type ReportBlockerInput = {
  taskId: string;
  runId: string;
  reason: string;
  requiredDecision?: string;
  evidence?: string[];
};
```

#### `spawn_subtasks`

```ts
type SpawnSubtasksInput = {
  parentTaskId: string;
  runId: string;
  strategy: "dag" | "checklist";
  subtasks: Array<{
    title: string;
    description: string;
    suggestedAgent: string;
    needs: string[];
    provides: string[];
    fileLocks?: string[];
    acceptance: string[];
  }>;
};
```

#### `emit_artifact`

```ts
type EmitArtifactInput = {
  taskId: string;
  runId: string;
  kind: "summary" | "patch" | "evidence" | "decision" | "log";
  path: string;
  description: string;
};
```

---

## 12. Skills

Skills seguem o padrão de diretório com `SKILL.md`.

Exemplo:

```txt
settings/skills/git-worktree/
  SKILL.md
  references/
    merge-policy.md
  scripts/
    inspect-worktree.sh
```

### 12.1 `SKILL.md`

```md
---
name: git-worktree
description: Use quando uma task precisa criar, inspecionar, atualizar ou preparar merge de um git worktree.
---

# Git Worktree Skill

## Regras

- Nunca execute merge direto em main.
- Subtasks devem nascer da branch da feature parent.
- Antes de finalizar, gere resumo de diff e status.

## Procedimento

1. Leia `worktree.yaml`.
2. Confirme o diretório atual.
3. Rode `git status --short`.
4. Execute mudanças somente no worktree da task.
5. Emita evidência antes de chamar `complete_task`.
```

### 12.2 Instalação de skills

A UI deve permitir:

- habilitar/desabilitar skill;
- associar skill a agent;
- associar skill a projeto;
- importar skill local;
- exibir metadados básicos;
- validar nome, descrição e presença de `SKILL.md`.

---

## 13. Orchestrator

### 13.1 Responsabilidades

1. Receber comandos da UI/CLI/assistant.
2. Validar schemas e regras.
3. Escrever eventos append-only.
4. Atualizar visão materializada.
5. Gerenciar fila de execução.
6. Gerenciar sessões de agents.
7. Gerenciar interrupção e retomada.
8. Gerenciar hooks.
9. Gerenciar worktrees.
10. Gerenciar locks e semáforos.
11. Gerenciar merges.
12. Publicar eventos para UI.

### 13.2 Coluna vs status operacional

A coluna representa etapa visual/processual.

Exemplos:

- Entrada
- Definição
- Construção
- Validação
- Bloqueado
- Encerrado

O status representa o estado operacional:

- idle
- queued
- running
- interrupting
- validating
- blocked
- merge_pending
- done
- failed
- canceled

Uma task pode estar na coluna `build` com status `queued`, `running`, `blocked` ou `merge_pending`.

### 13.3 Máquina de estados

```txt
idle ── queue ──> queued ── start ──> running
running ── complete_task ──> validating | merge_pending | done | blocked
running ── manual_move ──> interrupting ── abort/checkpoint ──> idle | queued | blocked
queued ── unsatisfied_dependency ──> queued
queued ── blocker_detected ──> blocked
merge_pending ── merge_ok ──> done | next_column
merge_pending ── conflict ──> blocked
blocked ── user_unblocks ──> queued | idle
```

### 13.4 Transição por conclusão do agent

1. Agent chama `complete_task`.
2. Orchestrator valida `taskId`, `runId`, coluna de destino e disposição.
3. Se existe manual override posterior ao `runId`, descarta movimentação e anexa saída como nota.
4. Executa hooks `beforeLeave` da coluna atual.
5. Move para a coluna de destino.
6. Atualiza `status`.
7. Executa hooks `onEnter` da nova coluna.
8. Se a nova coluna tem `autoStart`, agenda próxima execução.
9. Registra tudo em `events.jsonl`.

### 13.5 Transição manual pelo usuário

1. UI envia `task.move`.
2. Orchestrator registra `task.move_requested`.
3. Se task está running, aplica política:
   - `ask`: UI pergunta;
   - `soft`: envia steering/follow-up pedindo checkpoint;
   - `hard`: aborta sessão;
   - `after_checkpoint`: move quando agent registrar checkpoint ou ao expirar timeout.
4. Orchestrator marca `manualOverride.active = true`.
5. Orchestrator move a task.
6. Resultado tardio do run antigo não pode mover coluna.
7. Orchestrator decide se a nova coluna deve iniciar agent ou ficar sem agent.

### 13.6 Comandos conceituais

```ts
type Command =
  | { type: "task.create"; input: CreateTaskInput; commandId: string }
  | { type: "task.update"; taskId: string; patch: unknown; commandId: string }
  | { type: "task.move"; taskId: string; toColumn: string; mode?: "hard" | "soft" | "after_checkpoint"; commandId: string }
  | { type: "task.run"; taskId: string; agentId?: string; commandId: string }
  | { type: "task.interrupt"; taskId: string; mode: "soft" | "hard"; commandId: string }
  | { type: "task.decompose"; taskId: string; commandId: string }
  | { type: "settings.update"; scope: string; patch: unknown; commandId: string };
```

### 13.7 Idempotência

Todo comando deve ter `commandId`. Se o daemon receber o mesmo comando duas vezes, deve retornar o resultado já aplicado.

---

## 14. Hooks

Hooks são ações configuradas por escopo e disparadas por eventos.

### 14.1 Triggers suportados

- `onEnter`
- `beforeLeave`
- `afterLeave`
- `onAgentStart`
- `onAgentComplete`
- `onManualMove`
- `onBlocked`
- `onFailure`
- `onMergeReady`
- `onStale`

### 14.2 Tipos de hook

```yaml
kind: agent-action # agent-action | script | command | noop
```

### 14.3 Exemplo

```yaml
schema: kanban-code-agent/hook@1
id: summarize-blocker
label: Resumir bloqueio
kind: agent-action
agent: hook-agent
trigger: onEnter
prompt: settings/prompts/summarize-blocker.md
inputs:
  include:
    - task.yaml
    - description.md
    - events.jsonl
outputs:
  writeSummaryTo: summaries/blocker.md
  appendComment: true
timeoutMs: 120000
```

### 14.4 Regras

1. Hook não deve bloquear indefinidamente a movimentação.
2. Hook deve ter timeout.
3. Hook agent deve ter escopo curto.
4. Hook deve registrar `hook.started`, `hook.completed` ou `hook.failed`.
5. Hook de validação pode impedir saída da coluna se configurado como `blocking: true`.

---

## 15. Worktrees

### 15.1 Regra geral

Cada task executável cria um worktree próprio.

```txt
repo main
└── worktree task KCA-101 -> branch kca/KCA-101
```

### 15.2 Task master com subtasks

```txt
repo main
└── worktree feature KCA-200 -> branch kca/KCA-200
    ├── worktree subtask KCA-200A -> branch kca/KCA-200A, base kca/KCA-200
    ├── worktree subtask KCA-200B -> branch kca/KCA-200B, base kca/KCA-200
    └── worktree subtask KCA-200C -> branch kca/KCA-200C, base kca/KCA-200
```

Uma subtask nunca mergeia diretamente em `main`. Ela mergeia no worktree/branch da feature parent.

### 15.3 `worktree.yaml`

```yaml
schema: kanban-code-agent/worktree@1
taskId: KCA-200B
projectId: kanban-code-agent
repoPath: ~/Workspaces/kanban-code-agent
worktreePath: ~/.kanban-code-agent/settings/runtime/worktrees/kanban-code-agent/KCA-200B
branch: kca/KCA-200B
baseBranch: kca/KCA-200
parentTaskId: KCA-200
mergeTarget: kca/KCA-200
createdAt: 2026-06-11T20:15:00-03:00
status: ready
lastKnownHead: abc123
```

### 15.4 Criação de worktree

1. Validar projeto alvo.
2. Validar repoPath.
3. Verificar se branch já existe.
4. Criar branch a partir do target correto.
5. Criar worktree em runtime.
6. Registrar `worktree.created`.
7. Atualizar `worktree.yaml`.

### 15.5 Merge de subtask

1. Subtask finaliza e entra em `merge_pending`.
2. Orchestrator roda checks mínimos.
3. Orchestrator adquire semáforo `parent:<parentTaskId>:merge`.
4. Atualiza parent worktree.
5. Mergia branch da subtask no parent.
6. Se passar, registra `subtask.merged`.
7. Se houver conflito, registra `merge.conflict` e move subtask para bloqueado.
8. Libera semáforo.

### 15.6 Políticas de merge

- `sequential-into-parent-feature`: padrão.
- `squash-subtask`: cada subtask vira um commit no parent.
- `rebase-before-merge`: tenta rebase antes do merge.
- `manual-only`: gera patch e pede confirmação.

---

## 16. Task master e subtasks

### 16.1 Quando usar task master

Use master task quando:

- a feature é grande;
- há partes independentes;
- existem múltiplos repositórios ou áreas de código;
- diferentes agents podem trabalhar em paralelo;
- há dependências claras entre entregas.

### 16.2 Decomposição

O assistant ou architect agent lê:

- descrição;
- critérios de aceite;
- estrutura do repo;
- contexto do projeto;
- riscos;
- locks prováveis.

Ele gera:

1. subtasks pequenas;
2. objetivos verificáveis;
3. `needs` e `provides`;
4. file locks;
5. agent sugerido;
6. critérios de aceite;
7. plano de merge.

### 16.3 `subtasks.yaml`

```yaml
schema: kanban-code-agent/subtasks@1
parentTaskId: KCA-200
strategy: dag
mergePolicy: sequential-into-parent-feature
subtasks:
  - id: KCA-200A
    title: Definir contrato de agent runtime
    agent: architect
    needs: []
    provides:
      - contract:agent-runtime
    fileLocks:
      - packages/core/**
      - packages/schemas/**

  - id: KCA-200B
    title: Implementar adapter do Pi SDK
    agent: engineer
    needs:
      - contract:agent-runtime
    provides:
      - service:pi-adapter
    fileLocks:
      - packages/pi-adapter/**

  - id: KCA-200C
    title: Implementar painel de execução na UI
    agent: engineer
    needs:
      - contract:agent-runtime
    provides:
      - ui:agent-runtime-panel
    fileLocks:
      - apps/web/src/components/runtime/**

  - id: KCA-200D
    title: Integrar UI, daemon e runtime
    agent: engineer
    needs:
      - service:pi-adapter
      - ui:agent-runtime-panel
    provides:
      - integration:agent-runtime
    fileLocks:
      - apps/web/src/api/**
      - apps/daemon/src/routes/**
```

### 16.4 Regra de execução

Uma subtask fica `runnable` apenas quando:

1. todos os `needs` estão disponíveis;
2. os artefatos esperados existem;
3. os file locks não conflitam;
4. existe token global de task;
5. existe token do agent;
6. existe token do projeto;
7. o parent worktree está consistente;
8. a subtask não está invalidada por manual override.

### 16.5 Semáforos

```yaml
semaphores:
  global:tasks:
    tokens: 4
  project:kanban-code-agent:tasks:
    tokens: 2
  project:kanban-code-agent:merge:
    tokens: 1
  parent:KCA-200:merge:
    tokens: 1
  agent:engineer:
    tokens: 2
  resource:package-json:
    tokens: 1
```

### 16.6 Diagnóstico “por que não rodou?”

O orchestrator deve conseguir explicar:

- faltam dependências;
- agent sem token;
- WIP limit da coluna atingido;
- projeto sem slot;
- lock em conflito;
- parent worktree inconsistente;
- aguardando merge;
- aguardando confirmação humana;
- task bloqueada manualmente.

---

## 17. UI/UX

### 17.1 Direção visual

Estética minimalista, clara, com pouca ornamentação. A interface deve lembrar um produto técnico refinado, com foco em leitura, espaçamento, hierarquia e baixa carga cognitiva.

### 17.2 Topbar

Topbar deve ter apenas:

- marca/nome do produto;
- botão Configurações;
- botão Nova task;
- alternância de tema.

Não deve ter:

- botão filesystem;
- botão rodar prontas;
- texto técnico longo no header;
- projeto ativo;
- branch base global;
- linha de status do projeto ativo.

### 17.3 Board

O board deve ocupar a área principal.

Colunas devem mostrar no header apenas:

- nome da coluna;
- botão discreto para adicionar task.

Não mostrar no header da coluna:

- descrição longa;
- lista de tasks;
- detalhes de hooks;
- agentes;
- textos explicativos.

Esses detalhes aparecem no modal de configurações ou no painel de orchestrator.

### 17.4 Cards

Card compacto deve exibir:

- ID;
- tipo;
- título;
- descrição curta;
- status operacional;
- prioridade;
- agent atual;
- projetos alvo;
- progresso;
- dono;
- branch.

Detalhes como locks, needs/provides, eventos, arquivos e subtasks ficam no modal.

### 17.5 Chat principal

O chat principal fica à direita, estilo GPT-like.

Ele deve ajudar o usuário a:

- criar tasks;
- editar tasks;
- decompor master tasks;
- explicar bloqueios;
- explicar fila;
- pausar ou retomar agents;
- sugerir próxima ação;
- alterar configurações mediante confirmação;
- interagir com o orchestrator.

Sugestões rápidas aceitáveis:

- “Por que não iniciou?”
- “Decompor master”
- “Worktrees”
- “Próxima ação”

### 17.6 Painel do orchestrator

O painel do orchestrator pode ser uma aba lateral, não uma tela principal.

Ele mostra:

- capacidade;
- tasks rodando;
- fila;
- merge pendente;
- worktrees ativos;
- agents e tokens;
- bloqueios.

### 17.7 Modal da task

O modal da task deve ser dividido em 50% configuração e 50% chat interno.

Lado esquerdo:

- Resumo;
- Aceite;
- Execução;
- Worktree;
- Dependências;
- Subtasks;
- Hooks;
- Eventos;
- Arquivos.

Lado direito:

- chat da task;
- contexto isolado da task;
- perguntas sobre escopo, execução, dependências, hooks, worktree e próximos passos.

### 17.8 Dependências sem tela DAG

Não deve existir uma tela ou botão de DAG.

Dependências aparecem como uma visão simples dentro do modal da task/master task:

```txt
needs → task atual → provides
```

Para master tasks, a lista de subtasks pode mostrar status e dependências resumidas. Isso não deve virar uma tela separada.

### 17.9 Modal de configurações

O modal de configurações deve ter aproximadamente 90% da largura e 80% da altura da viewport.

Layout:

```txt
┌───────────────────────────────────────────┐
│ Configurações                         [x] │
├──────────────┬────────────────────────────┤
│ árvore       │ conteúdo editável           │
│ por escopo   │ do escopo selecionado        │
├──────────────┴────────────────────────────┤
│ status local                     [Salvar] │
└───────────────────────────────────────────┘
```

Escopos na árvore:

- Workspace;
- Interface;
- Persistência;
- Colunas;
- Movimento manual;
- Hooks por coluna;
- Catálogo de agents;
- Skills;
- Tools;
- Concorrência;
- Worktrees;
- Sessões;
- Repositórios;
- Permissões.

A UI não precisa mostrar onde cada arquivo é salvo. Isso é detalhe técnico da spec, não da tela.

---

## 18. Fluxos principais

### 18.1 Criar task

1. Usuário clica em Nova task ou pede ao assistant.
2. UI abre modal.
3. Usuário informa título, descrição, projetos alvo e critérios.
4. Daemon cria diretório da task.
5. Daemon grava arquivos iniciais.
6. Daemon emite `task.created`.
7. Board atualiza.

### 18.2 Mover task manualmente

1. Usuário arrasta card para outra coluna.
2. UI envia comando ao daemon.
3. Se task está running, UI pergunta:
   - interromper e mover;
   - mover após checkpoint;
   - cancelar.
4. Orchestrator aplica decisão.
5. Orchestrator registra manual override.
6. Orchestrator recalcula agent da nova coluna.

### 18.3 Agent conclui etapa

1. Agent chama `complete_task`.
2. Orchestrator valida run.
3. Orchestrator executa hooks.
4. Orchestrator move task.
5. Orchestrator agenda próximo agent se necessário.

### 18.4 Decompor master task

1. Usuário seleciona uma task.
2. Pede “decompor master”.
3. Assistant/architect analisa contexto.
4. Orchestrator cria subtasks via `spawn_subtasks`.
5. Cada subtask recebe needs/provides/locks.
6. Scheduler executa subtasks prontas em paralelo.
7. Merges acontecem sequencialmente no parent.

### 18.5 Retomar sessão

1. UI/daemon identifica sessão anterior.
2. Orchestrator valida se run ainda é válido.
3. Adapter reabre sessão/prompt conforme SDK.
4. Agent recebe resumo mais recente da task.
5. Execução continua sem exigir histórico versionado bruto.

---

## 19. Segurança e consistência

1. Escritas atômicas: escrever em arquivo temporário e renomear.
2. Eventos append-only antes da materialização quando possível.
3. Schema validation em toda entrada.
4. `commandId` idempotente.
5. Lock por task para escrita em diretório da task.
6. Lock por projeto para operações Git sensíveis.
7. Semáforo exclusivo para merge no parent.
8. Agent não move task editando YAML diretamente.
9. Manual override invalida conclusões antigas.
10. Worktree precisa estar limpo ou com commit antes de merge.
11. Credenciais nunca entram em `tasks/`.
12. Logs brutos de sessão ficam fora do versionamento.
13. Skills de terceiros devem exigir confirmação/trust.
14. Operações destrutivas devem exigir confirmação.

---

## 20. Eventos canônicos

```ts
type EventType =
  | "task.created"
  | "task.updated"
  | "task.move_requested"
  | "task.moved"
  | "task.blocked"
  | "task.unblocked"
  | "agent.queued"
  | "agent.started"
  | "agent.event"
  | "agent.checkpoint_requested"
  | "agent.interrupted"
  | "agent.completed"
  | "agent.failed"
  | "hook.started"
  | "hook.completed"
  | "hook.failed"
  | "worktree.created"
  | "worktree.updated"
  | "worktree.removed"
  | "subtasks.spawned"
  | "subtask.merged"
  | "merge.requested"
  | "merge.completed"
  | "merge.conflict"
  | "settings.updated";
```

Formato:

```ts
type KcaEvent = {
  ts: string;
  type: EventType;
  actor: "user" | "assistant" | "orchestrator" | "agent" | "hook" | "system";
  taskId?: string;
  runId?: string;
  commandId?: string;
  data?: Record<string, unknown>;
};
```

---

## 21. API local conceitual

### 21.1 RPC/WebSocket

A UI deve conversar com o daemon via uma API local simples.

```ts
type ClientMessage =
  | { type: "command"; command: Command }
  | { type: "subscribe"; topics: string[] }
  | { type: "query"; query: Query };

type ServerMessage =
  | { type: "command.result"; commandId: string; ok: boolean; error?: string; data?: unknown }
  | { type: "event"; event: KcaEvent }
  | { type: "snapshot"; data: WorkspaceSnapshot };
```

### 21.2 Queries

```ts
type Query =
  | { type: "board.snapshot" }
  | { type: "task.detail"; taskId: string }
  | { type: "orchestrator.status" }
  | { type: "settings.scope"; scope: string }
  | { type: "why_not_running"; taskId: string };
```

---

## 22. Critérios de aceite do MVP

### 22.1 Persistência

- [ ] `kca init` cria estrutura em `~/.kanban-code-agent`.
- [ ] Settings são salvos em YAML/Markdown.
- [ ] Tasks são salvas em YAML/Markdown/JSONL.
- [ ] Eventos são append-only.
- [ ] Runtime fica fora do versionamento por padrão.
- [ ] Índices podem ser reconstruídos.

### 22.2 UI

- [ ] Board renderiza colunas configuráveis.
- [ ] Cards podem ser criados, editados e movidos.
- [ ] Topbar não tem projeto ativo global.
- [ ] Cada task define projetos alvo.
- [ ] Chat principal fica à direita.
- [ ] Modal de task tem configuração + chat 50/50.
- [ ] Configurações abrem em modal 90%x80%.
- [ ] Configurações são editáveis pela UI.
- [ ] Não existe botão/tela DAG dedicada.

### 22.3 Orchestrator

- [ ] Orchestrator valida comandos.
- [ ] Orchestrator controla transições.
- [ ] Movimento manual interrompe ou checkpointa agent running.
- [ ] Resultado atrasado de agent não sobrescreve manual override.
- [ ] Scheduler respeita `maxParallelTasks`.
- [ ] Scheduler respeita tokens por agent.
- [ ] Scheduler respeita file locks.

### 22.4 Agents

- [ ] Agent por task roda com sessão dedicada.
- [ ] Sessão pode ser retomada.
- [ ] Agent finaliza etapa via `complete_task`.
- [ ] Agent pede input via `request_user_input`.
- [ ] Agents carregam instruções customizáveis.
- [ ] Agents carregam skills configuradas.

### 22.5 Worktrees

- [ ] Task cria worktree próprio.
- [ ] Subtask nasce da feature parent.
- [ ] Subtask mergeia na feature parent.
- [ ] Merge é sequencial por parent.
- [ ] Conflito move task para bloqueado.

### 22.6 Task master

- [ ] Master task gera subtasks.
- [ ] Subtasks têm needs/provides.
- [ ] Subtasks têm locks quando necessário.
- [ ] Scheduler executa subtasks prontas em paralelo.
- [ ] Orchestrator explica por que uma subtask não rodou.

---

## 23. Roadmap sugerido

### Fase 1 — FSDB e UI local

- Estrutura de diretórios.
- Schemas.
- FSDB com escrita atômica.
- Daemon local.
- UI Kanban.
- Modal de task.
- Modal de configurações.

### Fase 2 — Orchestrator básico

- Command bus.
- Event log.
- State machine.
- Movimento manual.
- Fila simples.
- Painel de orchestrator.

### Fase 3 — Pi adapter

- Sessão por task.
- Streaming para UI.
- Tools customizadas.
- Retomada de sessão.
- Interrupção.

### Fase 4 — Worktrees

- Criação por task.
- Branch naming.
- Diff/resumo.
- Checks.
- Merge controlado.

### Fase 5 — Hooks e skills

- Hooks por coluna.
- Hook agents.
- Skills por agent.
- UI de edição de instructions/skills.
- Permissões.

### Fase 6 — Master tasks

- Decomposer agent.
- Subtasks com DAG interno.
- Scheduler por needs/provides.
- File locks.
- Semáforos.
- Merge sequential no parent.

### Fase 7 — Polimento

- Command palette.
- Diagnóstico “por que não rodou?”.
- Doctor CLI.
- Export/import.
- Melhorias de acessibilidade.
- Test fixtures.

---

## 24. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---:|---|
| Agents editarem arquivos de estado diretamente | Alto | Tools tipadas e permissões; estado alterado apenas pelo daemon |
| Conflitos de merge frequentes | Alto | file locks, subtasks menores e merge sequencial no parent |
| UI ficar complexa demais | Médio | disclosure progressivo; detalhes só no modal/painel |
| Sessões conterem dados sensíveis | Alto | runtime fora do versionamento; retenção configurável |
| Divergência entre YAML e eventos | Médio | reconstrução a partir de JSONL e evento `task.recovered` |
| Skills inseguras | Alto | trust explícito, validação e escopo de permissões |
| Dependência forte do SDK | Médio | adapter isolado e testes de contrato |

---

## 25. Decisões finais desta versão

1. Não existe projeto ativo global.
2. Cada task declara seus `projectTargets`.
3. Orchestrator é determinístico.
4. Agent move task apenas por tool tipada.
5. Movimento manual é autoritativo.
6. Sessões brutas não são versionadas.
7. Runtime pode ser retomável sem virar parte do histórico Git.
8. Worktree de subtask nasce da branch/worktree da master feature.
9. Subtask mergeia no parent, não no main.
10. Não existe tela DAG dedicada; dependências aparecem dentro da task.
11. Configurações são editáveis pelo site por escopo.
12. A UI principal permanece Kanban + chat.

---

## 26. Referências técnicas consideradas

- Pi SDK: uso programático de sessões de agent, custom UI e integração em aplicações.
- Pi Extensions: tools customizadas, eventos, comandos e persistência de estado.
- Pi Skills: skills como pacotes de capacidade com `SKILL.md` e progressive disclosure.
- Pi RPC Mode: alternativa headless por JSONL quando isolamento por subprocesso for desejável.
