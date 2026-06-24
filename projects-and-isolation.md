# Spec & Plano — Isolamento de Tasks, Projetos e Gerenciamento de Agentes

> Status: **proposta** · Escopo: arquitetura de isolamento de execução, modelo de
> projetos, integração Git e ciclo de vida da task.
> Princípio guia: **lazy-but-correct** — a solução mais simples que sustenta
> segurança, isolamento e auditabilidade. Cada decisão registra o *teto* da
> abordagem escolhida e o *caminho de upgrade* quando esse teto for atingido.

---

## 1. Objetivo e escopo

Entregar quatro capacidades, em ordem de risco crescente:

1. **Projetos** com config minimalista (nome, slug, git URL, branch) e relação
   N:N com tasks.
2. **Isolamento de dados** por task/subtask (diretório dedicado — já quase
   pronto) e **isolamento de processo** via `systemd-run`.
3. **Integração Git** com worktrees por subtask e uma estratégia de merge com
   **um único escritor** no branch protegido.
4. **Estados de ciclo de vida** adicionais e **injeção segura de credenciais**.

Fora de escopo (YAGNI, ver §11): multi-host, autoscaling de agentes, pipeline
de deploy real, secret manager externo.

---

## 2. Estado atual (baseline do código)

| Aspecto | Hoje | Implicação |
|--------|------|------------|
| Execução do agente | In-process, `WorkerPool` chama `PiSdkAgentRunner` no mesmo processo do servidor | Sem isolamento de processo nem limite de recursos |
| `cwd` do agente | `getTaskDir()` → `.swarm/tasks/{taskId}` | Já existe diretório isolado por task; falta workspace de código |
| Projeto | **Dois** stores divergentes: `ProjectFileStore` (`.kanban-data/projects/*.json`) e um `Map` in-memory em `routes/projects.ts`. Campos: `name`, `description`, `taskIds` | Precisa unificar e adicionar campos git |
| Task↔Projeto | Inexistente no domínio (`Task` não conhece projeto) | Adicionar `projectIds` |
| Git | Nenhuma integração | Construir do zero |
| Estados | `PENDING → QUEUED → RUNNING → WAITING → COMPLETED \| FAILED \| CANCELLED` | `CANCELLED` **já existe** |
| Agente "Manager" | É um *agente de IA* (papel), não um processo separado | A proposta introduz hierarquia de **processos** Master/Manager/Worker |

**Decisão de terminologia** (evita ambiguidade com o agente de IA "Manager"):

- **Master** = o processo central (servidor/orquestrador atual). Dono do event
  log, do scheduler e do **único merge** no branch protegido.
- **Worker** = processo isolado (`systemd-run`) que executa **uma** run de
  agente de IA (qualquer papel: Manager, Engineer, QA…). Expõe um endpoint de
  controle. Substitui a chamada in-process.
- **Papel do agente** (Manager/Engineer/QA/…) continua sendo só configuração de
  prompt/modelo — independente de processo.

> Ou seja: o "Agent Manager" da proposta vira **um Worker rodando o papel
> Manager**. Não há um terceiro tipo de daemon. Menos partes móveis.

### 2.1 Pontos de integração confirmados (investigação no código)

Onde exatamente cada mudança encaixa — verificado lendo o código, não suposto:

| O que | Local (arquivo:linha) | Observação que muda o plano |
|------|----------------------|------------------------------|
| **Único ponto de execução de run** | `orquestrator.ts:633` `await this.piClient.run(agent, task, this, ...)` | É aqui (e só aqui) que se injeta worktree (antes) e isolamento de processo (substituição). Toda a Fase 3 gira em volta dessa linha. |
| **`cwd` NÃO vem do orquestrator** | `pi-client.ts` calcula `taskDir` internamente (`cwd: taskDir`) | Mudar `cwd → workspace/` toca **pi-client**, não orquestrator. Precisa passar `cwd` por parâmetro ou resolver workspace lá. |
| **Guard de concorrência** | `orquestrator.ts:636` `if (controller.signal.aborted \|\| task.activeRunId !== run.runId ...)` | Invariante crítico: output de run superada é descartado. O Worker isolado **tem** de preservar isso (descartar resultado se a unit foi superada). |
| **`ensureTaskDir` pré-run** | `orquestrator.ts:632` | Ponto natural para `ensureWorkspaceDir` + `git worktree add`. |
| **Aplicação de decisão / fim da task** | `orquestrator.ts:645` `applyDecision(...)` | Hook de pós-task: reconciliação (Manager) e transição para `REVIEW`. |
| **Emissão de evento** | `recordEvent(SWARM_EVENT_TYPE.X, ...)` | Novos eventos (§8) entram no const `SWARM_EVENT_TYPE` em `domain/types.ts`. |
| **Rota de projeto desconectada** | `http-server.ts:115` `registerProjectRoutes(fastify)` — sem store | Hoje usa `Map` in-memory; Fase 0 passa a injetar `ProjectFileStore`. |
| **WorkerPool é só concorrência** | `orquestrator.ts:327` `new WorkerPool(MAX_CONCURRENCY, RUN_TIMEOUT_MS)` | Continua controlando fila; execução é que sai de in-process. Não confundir com o "Worker" (processo isolado). |
| **Eventos existentes** | `domain/types.ts:86` `SWARM_EVENT_TYPE` (25 tipos) | Reusar convenção; nenhum tipo git/review existe ainda. |

---

## 3. Decisões de arquitetura (respostas diretas às perguntas)

### 3.1 Quem faz o merge no repositório principal?

**O Master, e somente ele.** Worker nunca escreve no branch protegido.

Modelo de duas camadas, espelhando a hierarquia:

```
Worker (subtask)         Manager (task)              Master (projeto)
─────────────────        ──────────────────          ──────────────────
commita no branch        merge sequencial dos         merge serial do branch
da subtask               branches de subtask em       de integração no branch
kca/<task>/<sub>         kca/<task> (integração)      padrão (main/master)
push só do próprio        resolve conflito ⇒          1 escritor por projeto
branch; nunca main        nova subtask "resolve"      (lock por projeto)
```

- **Worker**: só faz commit/push do **próprio** branch de subtask. Zero
  contato com `main`.
- **Manager** (papel, rodando num Worker): reconcilia os branches das suas
  subtasks num branch de integração `kca/<taskId>`, **um merge por vez**.
  Conflito vira uma subtask de resolução (retry com instruções) — o conflito
  não bloqueia o Master.
- **Master** (processo central): faz o merge final `kca/<taskId>` → branch
  padrão, **serial por projeto** (um `merge-lock` por projeto). É o único
  escritor do branch protegido ⇒ **nenhuma corrida possível** em `main`.

`ponytail:` lock global por projeto (não por arquivo). Teto: serializa merges
de um mesmo projeto. Upgrade: fila de merge por projeto + rebase automático se a
taxa de merges virar gargalo.

> Por padrão o merge final **não** é direto: o Master abre/atualiza um branch de
> integração e move a task para `REVIEW` (§6). Merge real só após aprovação
> (humano ou agente QA). Isso evita escrever em `main` automaticamente — a opção
> mais segura por default. Auto-merge é opt-in por projeto.

### 3.2 Concorrência: branches / worktrees

**Um mirror clone por projeto + um worktree por subtask.**

```
.swarm/projects/<slug>/repo.git/         # clone --mirror (bare), compartilhado
.swarm/tasks/<taskId>/workspace/<slug>/  # git worktree (cwd do Worker)
```

- **Não** clonar o repo N vezes. Um *mirror* por projeto; cada subtask recebe um
  `git worktree add` apontando para um branch próprio. Worktrees compartilham o
  object store ⇒ disco e fetch O(1) por projeto, não O(n) por task.
- Reconciliação = merge sequencial pelo dono (Manager → integração; Master →
  main). Sem merge concorrente no mesmo branch alvo.
- Naming determinístico (auditável, derivável do ID):
  - subtask: `kca/<taskId>/<subtaskId>`
  - integração: `kca/<taskId>`
- Limpeza: ao concluir/cancelar a task, `git worktree remove` + `git branch -D`
  dos branches de subtask já mergeados. Branch de integração sobrevive até o
  merge final/descarte.

`ponytail:` mirror local único; sem fetch incremental sofisticado. Teto: repos
grandes ocupam disco. Upgrade: `clone --filter=blob:none` (partial clone) +
`worktree --depth`.

### 3.3 Estados do Kanban

`CANCELLED` **já existe** — reusar (a proposta escreve "Canceled"; é o mesmo).

| Estado | Decisão | Justificativa |
|--------|---------|---------------|
| `REVIEW` (Waiting Review) | **Adicionar** | Gate entre "agente terminou" e merge/entrega. Distinto de `WAITING` (que é wait-group de dependências). |
| `DEPLOY` | **Adiar (opt-in)** | Só faz sentido com pipeline de deploy real. Sem isso é estado morto. Adicionar quando existir um destino de deploy. |
| `CANCELLED` | Já existe | — |

Ciclo proposto:

```
PENDING → QUEUED → RUNNING → WAITING ⇄ RUNNING
                      │
                      ├─ COMPLETED ──(projeto + gate)──▶ REVIEW ──▶ (merge) ──▶ DONE
                      ├─ FAILED
                      └─ CANCELLED
```

`REVIEW` é terminal-para-o-agente mas não-terminal-para-o-sistema: aprovar →
Master faz o merge; rejeitar → reabre como retry com feedback.

`ponytail:` `REVIEW` só quando a task tem ≥1 projeto e o projeto **não** está em
auto-merge. Task sem projeto vai direto a `COMPLETED`. Não criamos estado para
quem não precisa.

### 3.4 Credenciais

**Não usar HashiCorp Vault.** É infra de cluster para um sistema single-host
"filesystem como DB" — peso desproporcional. Usar a feature **nativa do
systemd**: `LoadCredentialEncrypted=`.

- Segredos cifrados com `systemd-creds encrypt` (chave da máquina/TPM), gravados
  fora do sandbox do agente.
- `systemd-run` injeta via `-p LoadCredentialEncrypted=git-token:<arquivo>`; o
  Worker lê de `$CREDENTIALS_DIRECTORY/git-token`. **Nunca** vai para env
  herdável, disco do worktree, log ou chat.
- Git usa o token via `GIT_ASKPASS` (script que ecoa o segredo do
  `$CREDENTIALS_DIRECTORY`) ou `url.<base>.insteadOf` com token em memória.
  Sem `git config` persistente com credencial.
- O Master detém os segredos (arquivo `0600`, dono = usuário do serviço, sob
  `.swarm/projects/<slug>/credentials/`, **fora** dos `ReadWritePaths` do
  Worker) e os repassa por run.

`ponytail:` systemd-creds + token efêmero por run. Teto: single-host, rotação
manual/curta. Upgrade: secret manager externo (Vault/cloud) **só** com
multi-host ou rotação automática obrigatória.

> Onde `systemd` não existe (dev em macOS/CI): fallback documentado para env var
> injetada apenas no processo filho (`spawn` com `env` restrito), sem `systemd`.
> Mesma regra: nunca persistir no worktree.

---

## 4. Modelo de domínio

### 4.1 Projeto (unificado)

Substituir os dois stores por **um** (`ProjectFileStore`), persistindo em
`.swarm/projects/<slug>/project.json`:

```ts
interface ProjectData {
  slug: string;          // id único, derivado/validado do nome (kebab-case)
  name: string;
  gitUrl?: string;       // opcional: projeto pode ser "doc-only" sem repo
  defaultBranch: string; // ex.: "main"
  autoMerge: boolean;    // default false ⇒ passa por REVIEW
  createdAt: string;
  updatedAt: string;
}
```

- `slug` é o identificador (não UUID) — legível, usado em paths e branches.
- `taskIds` **sai** do projeto: a relação é resolvida pela task (`projectIds`),
  evitando duas listas a sincronizar. Listagem "tasks do projeto" é derivada.

### 4.2 Relação Task ↔ Projeto (N:N flexível)

```ts
interface TaskOptions {
  // ...existente
  projectIds?: string[]; // 0 = sem projeto; 1 = comum; N = multi-repo
}
```

Regras:
- 0 projetos → workspace scratch (comportamento atual, `cwd = task dir`).
- 1+ projetos → um worktree por projeto em `workspace/<slug>/`; `cwd` do Worker =
  `.swarm/tasks/<taskId>/workspace/` (vê todos os repos linkados).
- Subtask herda `projectIds` do pai por padrão; pode restringir a um subconjunto.

### 4.3 Layout de diretórios

```
.swarm/
├── events/current.jsonl
├── state.snapshot.json
├── projects/
│   └── <slug>/
│       ├── project.json
│       ├── repo.git/            # mirror clone (object store compartilhado)
│       └── credentials/         # 0600, FORA do sandbox do Worker
└── tasks/
    └── <taskId>/
        ├── task.yml             # + projectIds
        ├── chat.jsonl
        ├── session.jsonl
        ├── artifacts.yaml
        ├── attachments/
        ├── artifacts/
        └── workspace/           # cwd do Worker
            └── <slug>/          # git worktree (branch kca/<taskId>/<subId>)
```

---

## 5. Isolamento de processo (Worker como serviço)

### 5.1 Contrato do Worker

Cada run vira um processo transiente. O Worker é um wrapper fino sobre o
`PiSdkAgentRunner` atual (reuso total da lógica de execução) expondo controle:

| Op | Descrição |
|----|-----------|
| `POST /run`    | inicia a run (config já no comando de spawn; idempotente) |
| `POST /cancel` | aborta a run em andamento |
| `GET /health`  | liveness/readiness |
| `GET /events`  | stream (SSE) de output/stats para o Master encaminhar ao event log |

**Transporte: Unix Domain Socket por padrão** (`workspace/.worker.sock`), TCP em
`127.0.0.1:<porta efêmera>` como alternativa quando a proposta exigir "porta".
UDS é mais simples (sem alocação/colisão de porta) e mais seguro (permissão de
arquivo, sem superfície de rede). O Master registra o endpoint no snapshot para
reconectar após restart.

`ponytail:` UDS + servidor HTTP mínimo (sem framework no Worker; `node:http`).
Teto: comunicação local 1-Master↔1-Worker. Upgrade: TCP+auth token se algum dia
for remoto.

### 5.2 Comando `systemd-run`

```bash
systemd-run --user --collect --unit=kca-<taskId>-<runId> \
  -p RuntimeMaxSec=<runTimeoutMs/1000> \
  -p MemoryMax=2G -p CPUQuota=200% -p TasksMax=512 \
  -p NoNewPrivileges=yes -p PrivateTmp=yes \
  -p ProtectSystem=strict -p ProtectHome=read-only \
  -p ReadWritePaths=<taskDir> \
  -p LoadCredentialEncrypted=git-token:<projects/<slug>/credentials/git-token> \
  --working-directory=<taskDir>/workspace \
  -- node dist/worker/main.js --task=<taskId> --run=<runId> --socket=<...>
```

- `--unit` (serviço transiente nomeado) ⇒ o Master gerencia por nome:
  `systemctl --user stop|status kca-<taskId>-<runId>`.
- `ReadWritePaths` restringe escrita ao diretório da task; `credentials/` fica de
  fora (read via `$CREDENTIALS_DIRECTORY`).
- `RuntimeMaxSec` = timeout duro a nível de SO (complementa o `WorkerPool` atual,
  que vira o controlador de concorrência/agendamento, não mais de execução).
- Cancel = `POST /cancel` (graceful) e, no fim, `systemctl stop` (hard kill).

### 5.3 Onde isso pluga no código

`WorkerPool` continua controlando concorrência. A execução muda de
"chamar `piClient.run` in-process" para "spawnar Worker via `systemd-run` e
encaminhar eventos". Introduz-se um `WorkerSupervisor` (infra) por trás de uma
interface, **atrás de feature flag** `SWARM_ISOLATION=systemd|inproc`
(default `inproc` até estabilizar). Fallback in-process preserva dev/CI sem
systemd.

`ponytail:` flag binária, dois modos. Sem plugin system para "runtimes futuros".
Adicionar um terceiro modo só quando existir um terceiro alvo real.

---

## 6. Fluxo Git fim-a-fim

```
1. Task linkada a projeto P entra em RUNNING.
2. Master garante mirror: .swarm/projects/P/repo.git (clone --mirror 1x; fetch nas próximas).
3. Para cada subtask: Master cria worktree + branch kca/<task>/<sub> a partir de defaultBranch.
4. Worker (systemd-run) executa no worktree; commits locais; push do próprio branch.
5. Manager (papel) reconcilia subtasks → kca/<task> (merge sequencial).
      conflito ⇒ subtask "resolve-conflict" (retry com diff).
6. Task vai a REVIEW (ou auto-merge se projeto.autoMerge).
7. Aprovação ⇒ Master faz merge serial kca/<task> → defaultBranch (lock por projeto)
      e push. Rejeição ⇒ retry com feedback.
8. Cleanup: worktrees + branches de subtask mergeados removidos.
```

Auditabilidade: todo passo emite `SwarmEvent` (novos tipos em §8). Branch e
commit SHA entram no event log ⇒ rastreável do pedido ao merge.

---

## 7. Impacto no código (arquivos a tocar)

| Fase | Arquivo | Mudança |
|------|---------|---------|
| 0 | `infrastructure/persistence/project-file-store.ts` | + `slug/gitUrl/defaultBranch/autoMerge`; remover `taskIds`; path `.swarm/projects/<slug>/` |
| 0 | `infrastructure/api/routes/projects.ts` | trocar `Map` in-memory por `ProjectFileStore`; Zod com slug/gitUrl/branch |
| 0 | `domain/task.ts`, `domain/types.ts` | + `projectIds` em `TaskOptions`; propagar no `serialize/fromSerialized` |
| 1 | `infrastructure/persistence/task-file-store.ts` | + `ensureWorkspaceDir`, helpers de worktree path |
| 2 | `infrastructure/git/git-repo.ts` *(novo)* | mirror clone, fetch, worktree add/remove, branch, commit, merge (wrapper `node:child_process`) |
| 2 | `application/orquestrator.ts` | hooks de pré-run (criar worktree) e pós-task (reconciliar/merge) |
| 3 | `infrastructure/process/worker-supervisor.ts` *(novo)* | `systemd-run` spawn + lifecycle; interface + impl `inproc` |
| 3 | `worker/main.ts` *(novo)* | servidor UDS fino sobre `PiSdkAgentRunner` |
| 3 | `application/worker-pool.ts` | delega execução ao supervisor (atrás da flag) |
| 4 | `infrastructure/security/credentials.ts` *(novo)* | resolução `systemd-creds` + fallback env |
| 5 | `domain/types.ts` | + `REVIEW` em `TASK_STATUS`; máquina de transição |
| 5 | `infrastructure/api/routes/tasks.ts` | endpoints approve/reject de REVIEW |

---

## 8. Novos eventos (event-sourcing)

Append ao event log — mantêm tudo auditável e reconstruível por replay:

```
PROJECT_CREATED / PROJECT_UPDATED / PROJECT_DELETED
TASK_PROJECT_LINKED { taskId, projectIds }
WORKTREE_CREATED   { taskId, subtaskId, slug, branch, baseSha }
COMMIT_CREATED     { taskId, subtaskId, slug, sha }
BRANCH_MERGED      { from, into, slug, sha }       // Manager→integração, Master→main
TASK_REVIEW_REQUESTED { taskId }
TASK_REVIEW_APPROVED / TASK_REVIEW_REJECTED { taskId, by, feedback? }
MERGE_BLOCKED      { taskId, slug, reason: 'conflict'|'lock'|'auth' }
WORKER_SPAWNED / WORKER_EXITED { taskId, runId, unit, code }
```

Snapshots permanecem projeções reconstruíveis desses eventos.

---

## 9. Backlog executável (fases → tasks → DoD)

> Cada fase é independente, entregável e reversível. Cada task tem um *DoD
> próprio* (a coisa menor que falha se a lógica quebrar). DoD global em §10.
> Tamanho alvo por task: 1 PR pequeno, verde no CI.

### Fase 0 — Modelo de Projeto + N:N *(sem Git, sem processo)*

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T0.1 | Estender `ProjectData`: `slug/gitUrl?/defaultBranch/autoMerge`, remover `taskIds`, path `.swarm/projects/<slug>/project.json` | `project-file-store.ts` | Teste: cria/lê/atualiza projeto com novos campos; slug duplicado rejeitado; corrupt file → null |
| T0.2 | Validar/gerar `slug` (kebab-case, único) | `project-file-store.ts` | Teste: `"My App" → "my-app"`; colisão lança erro |
| T0.3 | Trocar `Map` in-memory por `ProjectFileStore` na rota; injetar via `registerProjectRoutes(fastify, store)` | `routes/projects.ts`, `http-server.ts:115` | Teste de rota: POST/GET/PATCH/DELETE persistem em disco; Zod cobre slug/gitUrl/branch |
| T0.4 | `projectIds?: string[]` em `TaskOptions` + `serialize/fromSerialized` | `domain/task.ts`, `domain/types.ts` | Teste: round-trip serialize preserva `projectIds`; default `[]` |
| T0.5 | Eventos `PROJECT_*` e `TASK_PROJECT_LINKED` no `SWARM_EVENT_TYPE` | `domain/types.ts` | `recordEvent` emite; replay reconstrói link |
| T0.6 | UI: form de projeto (slug/gitUrl/branch) + seletor multi-projeto na task | `web/` | Manual: criar projeto, linkar 0/1/N a uma task |

### Fase 1 — Workspace isolado por task

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T1.1 | `ensureWorkspaceDir(taskId)` + helper de path de worktree | `task-file-store.ts` | Teste: cria `workspace/`; sandbox rejeita traversal |
| T1.2 | `cwd` do agente = `workspace/` (passar por config, não recalcular taskDir) | `pi-client.ts`, `orquestrator.ts:632` | Teste: run recebe `cwd` = workspace; escrita fora é rejeitada pelo sandbox |

### Fase 2 — Integração Git (worktrees + merge)

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T2.1 | `GitRepo` wrapper (`node:child_process`): `ensureMirror/fetch/worktreeAdd/worktreeRemove/branch/commit/merge` | `infrastructure/git/git-repo.ts` *(novo)* | Teste em repo tmp: mirror 1x, worktree add/remove, commit, merge fast-forward e 3-way |
| T2.2 | Hook pré-run: criar worktree+branch `kca/<task>/<sub>` a partir de `defaultBranch` | `orquestrator.ts:632` | Teste: subtask roda em worktree próprio; `WORKTREE_CREATED` no log com `baseSha` |
| T2.3 | Reconciliação Manager → `kca/<task>` (merge sequencial das subtasks) | `orquestrator.ts:645` (`applyDecision`) | Teste: 2 subtasks → integração contém ambos commits; ordem determinística |
| T2.4 | Conflito → subtask `resolve-conflict` (retry com diff) | `orquestrator.ts` | Teste: merge conflitante emite `MERGE_BLOCKED{reason:conflict}` e cria subtask |
| T2.5 | Merge serial Master → `defaultBranch` com lock por projeto | `orquestrator.ts` + `git-repo.ts` | Teste: 2 tasks no mesmo projeto não mergeiam concorrente; 1 escritor em main |
| T2.6 | Cleanup: `worktree remove` + `branch -D` de subtasks mergeadas | `git-repo.ts` | Teste: após task terminal, sem worktrees/branches órfãos; `worktree prune` no boot |
| T2.7 | Eventos git (`WORKTREE_CREATED/COMMIT_CREATED/BRANCH_MERGED/MERGE_BLOCKED`) | `domain/types.ts` | Replay reconstrói SHA/branch de cada passo |

### Fase 3 — Isolamento de processo (systemd-run)

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T3.1 | `worker/main.ts`: servidor `node:http` sobre UDS, `run/cancel/health/events`, reusa `PiSdkAgentRunner` | `worker/main.ts` *(novo)* | Teste: `/run` executa e `/events` faz stream; `/cancel` aborta |
| T3.2 | `WorkerSupervisor` (interface) + impl `SystemdSupervisor` (`systemd-run --unit`) e `InprocSupervisor` | `infrastructure/process/worker-supervisor.ts` *(novo)* | Teste: `inproc` idêntico ao atual; `systemd` spawna unit (skip se indisponível) |
| T3.3 | Flag `SWARM_ISOLATION=systemd\|inproc` (default `inproc`) | `config.ts` | Teste: env override; default seguro |
| T3.4 | Substituir `piClient.run` direto pelo supervisor preservando o guard de descarte | `orquestrator.ts:633-636` | Teste: output de unit superada é descartado (invariante `activeRunId`) |
| T3.5 | Limites: `RuntimeMaxSec/MemoryMax/CPUQuota/ReadWritePaths` + cancel via `systemctl stop` | `worker-supervisor.ts` | Teste manual: estourar memória mata a unit; cancel encerra |
| T3.6 | Reconexão pós-restart: snapshot guarda unit/socket; boot reconcilia | `orquestrator.ts`, `snapshot-store.ts` | Teste: restart com run ativa não duplica execução |

### Fase 4 — Credenciais seguras

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T4.1 | `credentials.ts`: resolver token via `$CREDENTIALS_DIRECTORY` (systemd) com fallback env | `infrastructure/security/credentials.ts` *(novo)* | Teste: lê de dir de credencial simulado; ausência → erro claro |
| T4.2 | `GIT_ASKPASS` script + injeção `LoadCredentialEncrypted` no spawn | `worker-supervisor.ts`, `git-repo.ts` | Teste: push autentica; sem credencial em `git config` |
| T4.3 | Garantia anti-vazamento | — | Teste: `grep -r <token> .swarm` vazio; token ausente de log/chat/worktree |

### Fase 5 — Estado REVIEW + gate de merge

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T5.1 | `REVIEW` em `TASK_STATUS` + transições válidas | `domain/types.ts`, `task.ts` | Teste: transição inválida rejeitada; `REVIEW` não-terminal |
| T5.2 | Eventos `TASK_REVIEW_REQUESTED/APPROVED/REJECTED` | `domain/types.ts` | Replay reconstrói estado de review |
| T5.3 | Endpoints approve/reject | `routes/tasks.ts` | Teste de rota: approve → merge Master; reject → retry com feedback |
| T5.4 | `autoMerge` opt-in pula REVIEW | `orquestrator.ts` | Teste: projeto `autoMerge=true` mergeia direto; `false` para em REVIEW |
| T5.5 | UI: coluna REVIEW + botões approve/reject | `web/` | Manual: aprovar/rejeitar pelo board |

`DEPLOY`: fora do backlog até existir destino de deploy real (§3.3).

---

## 9.1 Definition of Done

**DoD de task** (toda task acima só fecha com):
1. Código en-US, comentários pt-BR, kebab-case (CODE_GUIDELINE).
2. ≥1 teste runnável que falha se a lógica quebrar (o menor possível; sem framework novo).
3. `pnpm lint && pnpm typecheck && pnpm test` verdes.
4. Eventos novos persistidos **e** reconstruídos por replay (event-sourcing intacto).
5. Nenhuma operação de I/O fora do `PathSandbox`.
6. `graphify update` rodado após alteração estrutural.

**DoD de fase** (gate para a próxima):
- Fase 0: projeto com slug/gitUrl/branch criado e linkado 0/1/N; sobrevive a restart.
- Fase 1: agente escreve só dentro do `workspace/`; escape rejeitado.
- Fase 2: 2 subtasks concorrentes mergeiam sem corrida; conflito vira subtask; merge final 1x em main; SHA no log.
- Fase 3: run em unit transiente com limites aplicados; cancel encerra; `inproc` idêntico; restart não duplica.
- Fase 4: token nunca em log/chat/worktree/`git config`; push autentica; grep vazio.
- Fase 5: task com projeto não auto-merge para em REVIEW; approve mergeia; reject reabre.

**DoD da feature** (entrega completa):
- As 4 perguntas (§12) respondidas em código, não só em doc.
- Trilha de auditoria do pedido ao merge reconstruível por replay.
- Modo `inproc` mantém dev/CI funcionando sem systemd.
- `docs/software` e `docs/usage` atualizados (projetos, isolamento, estados).

---

## 10. Riscos e mitigação

| Risco | Mitigação |
|------|-----------|
| `systemd-run --user` indisponível (mac/CI) | Flag `inproc` como fallback de 1ª classe |
| Conflitos de merge frequentes | Subtask de resolução + merge sequencial; granularidade menor de subtask |
| Lock por projeto vira gargalo | Upgrade documentado: fila de merge + rebase auto |
| Vazamento de credencial | `systemd-creds`, fora de `ReadWritePaths`, `GIT_ASKPASS`, teste de grep |
| Worktree órfão após crash | Reconciliação no boot: `git worktree prune` + replay do event log |
| Mirror clone gigante | Upgrade: partial clone `--filter=blob:none` |

---

## 11. Decisões adiadas (YAGNI / ponytail)

- **HashiCorp Vault** — adiado; `systemd-creds` cobre single-host.
- **Estado `DEPLOY`** — adiado até pipeline real.
- **Multi-host / pool remoto de Workers** — adiado; UDS local resolve hoje.
- **Plugin system de runtimes** — adiado; 2 modos (`systemd`/`inproc`) bastam.
- **Fila de merge sofisticada** — adiado; lock serial por projeto basta no início.
- **Partial/shallow clone** — adiado; mirror simples até disco doer.

---

## 12. Resumo das respostas

1. **Merge**: só o **Master** escreve no branch protegido; Manager reconcilia
   subtasks; Worker nunca toca `main`. Default = abrir integração + `REVIEW`,
   não auto-merge.
2. **Concorrência**: 1 mirror por projeto, 1 worktree+branch por subtask, merge
   sequencial; sem corrida no branch alvo.
3. **Estados**: adicionar `REVIEW`; `CANCELLED` já existe; `DEPLOY` adiado.
4. **Credenciais**: `systemd-creds`/`LoadCredentialEncrypted` + `GIT_ASKPASS`;
   Vault só com multi-host.
