# Spec & Plano — Isolamento de Tasks, Projetos e Gerenciamento de Agentes

> Status: **parte implementada, parte proposta** · Escopo: arquitetura de
> isolamento de execução, modelo de projetos, integração Git e ciclo de vida da
> task.
> Princípio guia: **lazy-but-correct** — a solução mais simples que sustenta
> segurança, isolamento e auditabilidade. Cada decisão registra o *teto* da
> abordagem escolhida e o *caminho de upgrade* quando esse teto for atingido.
>
> **Companheiro de implementação do `PROJECT.md`.** Onde o `PROJECT.md` descreve
> *o que* e *por que* (conceitual), este documento descreve *onde no código* e
> *como* (concreto). A §0 mapeia cada mecanismo deste doc a uma seção conceitual
> do `PROJECT.md`. Toda citação `arquivo:linha` foi verificada contra o código
> vivo (orquestrator.ts ≈ 3100 linhas) — as citações antigas (`:6xx`) ficaram
> obsoletas e foram reescritas.

---

## 0. Mapa conceitual: este doc ↔ PROJECT.md

| Mecanismo deste doc | Conceito no PROJECT.md | Estado |
|---|---|---|
| Isolamento de processo (Worker via `systemd-run`) | §1.5 "desacoplar o cérebro das mãos"; §3.2/§6 "o sandbox restringe" | **proposto** (Fase 3) |
| `cwd` por task (`.swarm/tasks/<id>`) → worktree por task | §4 "Aguardando Dependência = desidratado"; §1.4 "toda Subtask é uma Task" | dir por task **feito**; worktree **proposto** |
| Worker transiente morre ao fim da run | §3.3 "desidratar = externalizar e liberar o worker" | conceitualmente já: o estado vive no ledger, não no processo |
| Reidratação ao spawnar (scope-spec/progress-log/env-resume) | §3.3 reidratação seletiva; §3.5 artefatos de continuidade | **feito** (in-process); sobrevive ao isolamento |
| Guard `activeRunId` (descartar output de run superada) | §3.6 idempotência/checkpoints; §13.4 "estado vive no ledger" | **feito** (3 pontos) |
| Tetos de custo/tempo/profundidade/estagnação | §10 condições de parada; §5.3 monitor de convergência | **feito** (governança + convergência) |
| Estado `REVIEW` + gate de avaliação dupla | §4 "Em Revisão/Validação"; §8.2 avaliador independente; §11 DoD | estado **feito**; gate de **merge** proposto |
| Merge num único escritor no branch protegido | §11 "consolidado ao destino principal" | **proposto** (Fase 2) |
| Injeção de credencial git "nunca vazar" | §6 "o sandbox restringe"; §7 "o Harness garante" | **proposto** (Fase 4) |
| Auth de API (bearer token opt-in) | §7 "o Harness garante" (controle de acesso) | **feito** (`SWARM_AUTH_TOKEN`) |
| Event log append-only + snapshot reconstruível | §1.3 Kanban como SSOT; §3.3 ledger durável | **feito** (tasks); **projetos ainda não** |

A leitura curta: **a continuidade, a governança e o estado já são fiéis ao
`PROJECT.md`**; o que falta é o **isolamento físico** (processo + worktree +
credencial git) — a camada "mãos/sandbox" que hoje roda in-process.

---

## 1. Objetivo e escopo

Entregar quatro capacidades, em ordem de risco crescente:

1. **Projetos** com config minimalista (slug, git URL, branch) e relação N:N com
   tasks. *(o store já está unificado; falta o schema git e o link na task)*
2. **Isolamento de dados** por task/subtask (diretório dedicado — **já pronto**)
   e **isolamento de processo** via `systemd-run` *(proposto)*.
3. **Integração Git** com worktrees por subtask e merge com **um único escritor**
   no branch protegido *(proposto)*.
4. **Gate de merge** sobre o estado `REVIEW` **já existente** e **injeção segura
   de credenciais** *(proposto)*.

Fora de escopo (YAGNI, ver §11): multi-host, autoscaling de agentes, pipeline de
deploy real, secret manager externo.

---

## 2. Estado atual (baseline do código)

> Reescrito contra o código vivo. Várias linhas que a versão anterior listava
> como "a fazer" **já existem** — marcadas como ✅ FEITO para evitar retrabalho.

| Aspecto | Hoje (verificado) | Implicação |
|--------|------|------------|
| Execução do agente | In-process. `pumpQueue` (`orquestrator.ts:1740`) drena `taskQueue` e chama `runTask` **direto** (`:1749`); `runTask` chama `piClient.run` (`:1178`) → `PiSdkAgentRunner.run` (`cli/pi-runner.ts:92`), que importa o Pi SDK e roda no mesmo processo. | Sem isolamento de processo nem limite de recursos. `SWARM_ISOLATION` **não existe**. |
| Concorrência | **Sem teto.** `WorkerPool` (`:439`, só `RUN_TIMEOUT_MS`) é hoje **vestigial** — usado apenas como saco de `AbortController` em `cancel`/`cancelAll` (`:838`,`:1624`); `enqueue`/timeout são código morto. `pumpQueue` drena a fila inteira em `while`, então runs rodam **paralelas e ilimitadas** (só o dedup `runningTaskIds` e o single-run por card limitam). | ⚠️ Premissa antiga "WorkerPool controla concorrência" é **falsa**. O isolamento precisa **introduzir** um teto real e um timeout real (ambos inexistentes hoje). |
| Timeout por run | **Não enforça.** `RUN_TIMEOUT_MS` (default 300000) vai ao `WorkerPool`, mas o `setTimeout→abort` mora em `enqueue`, que nunca é chamado. `runTask` aguarda `piClient.run` sem wrapper de timeout. | Só aborta via cancel/move/shutdown explícito. Restaurar timeout é parte da Fase 3. |
| `cwd` do agente | `.swarm/tasks/{taskId}` via `Orquestrator.getTaskDir` (`:1083-1086`, `sandbox.resolveSubpath`). `pi-client` **não calcula** o path: chama de volta `orquestrator.getTaskDir` (`pi-client.ts:94`) e passa `cwd: taskDir` (`:170`, e no repair `:206`). ✅ dir isolado por task FEITO. | Fonte de verdade do cwd = `getTaskDir`. Mover para `workspace/` toca `getTaskDir` **e** os call-sites de pi-client. Falta o workspace de código. |
| Projeto | ✅ **Store unificado.** `registerProjectRoutes(fastify, new ProjectFileStore(...))` (`http-server.ts:130`); **não há mais `Map` in-memory**. Persiste em `.kanban-data/projects/<uuid>.json` (`project-file-store.ts:41`). Campos: `id(UUID)`, `name`, `description`, `taskIds`, `createdAt`, `updatedAt` (`:11-18`). | Falta o **schema git** (slug/gitUrl/defaultBranch/autoMerge) e migrar o id UUID→slug. `taskIds` ainda existe no projeto. |
| Persistência de projeto | **Não é event-sourced.** CRUD é `AtomicWriter.writeJson` puro (`:136-139`); nenhum evento `PROJECT_*`. `delete` grava string vazia (tombstone, `:91-105`) em vez de `unlink`. | ⚠️ Contradiz o SSOT do `PROJECT.md` §1.3. Trazer projetos ao event log é mais trabalho do que a versão anterior sugeria. |
| Task↔Projeto | **Inexistente.** `TaskOptions` (`task.ts:45-52`) não tem `projectIds`; `grep projectIds src/` vazio; `serialize/fromSerialized` não carregam. | Adicionar `projectIds` (única parte do domínio de projetos genuinamente não construída). |
| Git | Nenhuma integração. `grep worktree\|GIT_ASKPASS\|child_process.*git src/` vazio. | Construir do zero (Fase 2). |
| Estados | ✅ **9 estados** (`types.ts:4-13`): `PENDING, QUEUED, RUNNING, WAITING, SUSPENDED, REVIEW, COMPLETED, FAILED, CANCELLED`. Máquina de transição completa em `state-machine.ts:14-63`, enforçada por `Task.setStatus` (`task.ts:221-231`). | `REVIEW`, `SUSPENDED`, `CANCELLED` **já existem**. Falta só o **gate de merge** sobre `REVIEW`. |
| Eventos | ✅ **29 tipos** (`types.ts:88`). Já incluem `TASK_REVIEW`, `TASK_SUSPENDED`, `RUN_TIMEOUT`, `BUDGET_EXCEEDED`, `HEARTBEAT`, `RUN_CANCELLED`, `TASK_ARCHIVED`. | Faltam só git/projeto/worker: `WORKTREE_*`, `COMMIT_*`, `BRANCH_MERGED`, `MERGE_BLOCKED`, `PROJECT_*`, `TASK_PROJECT_LINKED`, `WORKER_*`. |
| Auth de API | ✅ **Bearer token opt-in** (`middleware/auth.ts`, `http-server.ts:91-93`) via `SWARM_AUTH_TOKEN`. No-op quando ausente. | Cobre acesso à API, **não** credencial git. Ver §3.5. |
| Continuidade | ✅ scope-spec.json / progress-log.jsonl / env-resume.json por task (`task-file-store.ts:151-191`), reidratados a cada run (`orquestrator.ts:1172-1177`) e injetados no prompt (`prompt-builder.ts:67-99`). | Reidratação já existe; o isolamento só precisa **preservá-la** (§5.4). |
| Governança | ✅ `Governance` value object com 7 tetos (`domain/governance.ts`), snapshot imutável por run (`run.ts:13`, `orquestrator.ts:2562`); budget + convergência gated antes de `applyDecision`. | Os hard ceilings do `PROJECT.md` §10 **já operam**. |
| Gate de avaliação | ✅ **opt-in** via `SWARM_EVALUATION_GATE=1` (`orquestrator.ts:433`). Ligado, um Manager root precisa passar QA + Code Review (avaliadores independentes) antes de chegar a `REVIEW` (gate `:1907`/`:1951`). | Implementa o avaliador independente do `PROJECT.md` §8.2 e o DoD §11. É o gate natural onde o merge git pendura (§3.1). |
| Agente "Manager" | É um *papel de IA* (prompt/modelo), não um processo. | A proposta introduz hierarquia de **processos** Master/Manager/Worker. |

**Decisão de terminologia** (evita ambiguidade com o agente de IA "Manager"):

- **Master** = o processo central (servidor/orquestrador atual). Dono do event
  log, do scheduler (`pumpQueue`) e do **único merge** no branch protegido.
- **Worker** = processo isolado (`systemd-run`) que executa **uma** run de agente
  de IA (qualquer papel). Expõe um endpoint de controle. *Proposto* — substitui a
  chamada in-process.
- **Papel do agente** (Manager/Engineer/QA/…) continua sendo só configuração de
  prompt/modelo — independente de processo.

> O "Agent Manager" da proposta vira **um Worker rodando o papel Manager**. Não há
> um terceiro tipo de daemon. Menos partes móveis.

### 2.1 Pontos de integração confirmados (citações verificadas)

Onde exatamente cada mudança encaixa — lido no código, com linhas atuais:

| O que | Local (arquivo:linha) | Observação que muda o plano |
|------|----------------------|------------------------------|
| **Scheduler real** | `orquestrator.ts:1740` `pumpQueue` → `:1749` chama `runTask` direto | É o `pumpQueue`, **não** o `WorkerPool`, que agenda. Sem teto de concorrência. Qualquer isolamento entra aqui. |
| **Único ponto de execução de run** | `orquestrator.ts:1178` `await this.piClient.run(agent, task, this, triggerEvents, controller.signal, continuity)` | Hook load-bearing para worktree (antes) e isolamento (substituição). Agora recebe `signal` + `continuity`. |
| **Segundo ponto de execução (repair)** | `orquestrator.ts:1198` `piClient.repairInvalidOutput` (→ `pi-client.ts:183-217`) | Re-run sem ferramentas para corrigir JSON inválido. **Também roda o agente in-process** ⇒ há **DOIS** call-sites a isolar, não um. |
| **`cwd` source of truth** | `orquestrator.ts:1083-1086` `getTaskDir` (`sandbox.resolveSubpath('.swarm','tasks',taskId)`) | pi-client passa `cwd: taskDir` (`pi-client.ts:94,170,206`) chamando `getTaskDir`. Mover cwd→workspace toca `getTaskDir` + esses sites. |
| **Guard de descarte (run superada)** | `orquestrator.ts:1181` `if (controller.signal.aborted \|\| task.activeRunId !== run.runId \|\| task.status !== RUNNING) return;` | Invariante crítico em **3 pontos**: após run (`:1181`), após repair (`:1206`), no catch (`:1238`). O Worker isolado **tem** de preservar os três. AbortController criado em `:1165`; aborts vêm de `cancelActiveRun` (`:844`), `dequeue` (`:835`), `shutdown` (`:1626`). |
| **`ensureTaskDir` pré-run** | `orquestrator.ts:1171` `this.taskFileStore.ensureTaskDir(task.taskId)` (def `task-file-store.ts:282`) | Hook natural para `ensureWorkspaceDir` + `git worktree add`. Coexiste com `ensureScopeSpec` (`:1172`) e a carga de continuidade (`:1174-1176`). |
| **Carga de continuidade (reidratação)** | `orquestrator.ts:1172-1177` (scope-spec/progress-log/env-resume → `continuity`) | Janela de reidratação (PROJECT.md §3.3/§3.5). O hook de worktree mora junto desta janela. |
| **Gates de governança** | budget/ceiling `:1186-1189`; convergência/estagnação `:1222-1233`; snapshot `:2562` | Qualquer merge/reconcile pós-task roda **depois** desses gates (PROJECT.md §10). |
| **Aplicação de decisão / fim da task** | `orquestrator.ts:1235` `applyDecision(...)` (def `:1759`) | Hook pós-task. Ramifica em `retry`/`completed`/`waiting`; reconcile/merge entra no ramo `completed`. |
| **Emissão de evento** | `recordEvent(type, { task, parentId, runId, waitId, messages, payload })` (`:2972`) | Assinatura **estruturada** (não posicional). Dedup de eventos terminais salvo `payload.allowDuplicateTerminalEvent` (`:2983-`). Novos tipos em `SWARM_EVENT_TYPE` (`types.ts:88`). |
| **Rota de projeto** ✅ unificada | `http-server.ts:130` `registerProjectRoutes(fastify, new ProjectFileStore(...))`; `routes/projects.ts:25` recebe store | **Já injeta** o store. Resta o schema (Zod valida só name/description/taskIds, `routes/projects.ts:7-17`). |
| **Eventos existentes** ✅ | `domain/types.ts:88` `SWARM_EVENT_TYPE` (**29 tipos**) | Reusar convenção e o envelope `SwarmEvent` (`events.ts:4-25`: seq/eventId/type/taskId/parentId/runId/waitId/ts/messages/processedByTaskIds/payload). Snapshot em `version:2`. |

---

## 3. Decisões de arquitetura (respostas diretas às perguntas)

### 3.1 Quem faz o merge no repositório principal?

**O Master, e somente ele.** Worker nunca escreve no branch protegido. *(Toda
esta seção é proposta — não há git no código hoje.)*

```
Worker (subtask)         Manager (task)              Master (projeto)
─────────────────        ──────────────────          ──────────────────
commita no branch        merge sequencial dos         merge serial do branch
da subtask               branches de subtask em       de integração no branch
kca/<task>/<sub>         kca/<task> (integração)      padrão (main/master)
push só do próprio        resolve conflito ⇒          1 escritor por projeto
branch; nunca main        nova subtask "resolve"      (lock por projeto)
```

- **Worker**: só faz commit/push do **próprio** branch de subtask. Zero contato
  com `main`.
- **Manager** (papel, rodando num Worker): reconcilia os branches das suas
  subtasks num branch de integração `kca/<taskId>`, **um merge por vez**.
  Conflito vira uma subtask de resolução (retry com instruções) — o conflito não
  bloqueia o Master.
- **Master** (processo central): faz o merge final `kca/<taskId>` → branch
  padrão, **serial por projeto** (um `merge-lock` por projeto). Único escritor do
  branch protegido ⇒ **nenhuma corrida possível** em `main`.

`ponytail:` lock global por projeto (não por arquivo). Teto: serializa merges de
um mesmo projeto. Upgrade: fila de merge por projeto + rebase automático se a
taxa de merges virar gargalo.

> Por padrão o merge final **não** é direto: o Master abre/atualiza um branch de
> integração e move a task para `REVIEW` (estado que **já existe**, §3.3). Merge
> real só após aprovação. Auto-merge é opt-in por projeto. Isso reusa o gate de
> avaliação dupla (QA + Code Review) que já leva a `REVIEW` hoje — o git só pendura
> o merge nesse gate (PROJECT.md §11).

### 3.2 Concorrência: branches / worktrees

**Um mirror clone por projeto + um worktree por subtask.** *(proposto)*

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
  dos branches de subtask já mergeados. **Coordenar com o `archiveTask` já
  existente** (`task-file-store.ts:218-241`, move a task para `_archived/`): o
  worktree precisa ser removido **antes** do arquivamento mover o diretório.

`ponytail:` mirror local único; sem fetch incremental sofisticado. Teto: repos
grandes ocupam disco. Upgrade: `clone --filter=blob:none` (partial clone) +
`worktree --depth`.

### 3.3 Estados do Kanban

✅ **`REVIEW`, `SUSPENDED` e `CANCELLED` já existem e estão ligados ao ciclo de
vida.** A versão anterior tratava `REVIEW` como trabalho futuro — **não é**. O
único trabalho restante é o **gate de merge** pendurado em `REVIEW`.

Estados implementados (`types.ts:4-13`, `state-machine.ts:14-63`), mapeados 1:1
aos estados conceituais do PROJECT.md §4:

| Estado (código) | PROJECT.md §4 | Notas |
|---|---|---|
| `PENDING` | Backlog | — |
| `QUEUED` | Aguardando Execução | drenado por `pumpQueue` |
| `RUNNING` | Em Execução | — |
| `WAITING` | Aguardando Dependência (desidratado) | `waitingReason`: `subtasks`/`human`/`validation` |
| `SUSPENDED` | Suspensa por Timeout | `WAITING(human)` cujo prazo estourou → `SUSPENDED` (`orquestrator.ts:2182`, `failureReason:'human_timeout'`), não `FAILED` |
| `REVIEW` | Em Revisão / Validação | atingido pós-avaliação (QA/Code Reviewer); gate humano via `completeTaskByUser` (`:625`) |
| `COMPLETED` | Concluída | terminal de sucesso |
| `FAILED` | Falhou | `FailureReason`: `attempts`/`stagnation`/`ceiling`/`blocked`/`human_timeout`/`cancelled_by_user` |
| `CANCELLED` | Cancelada | terminal |

Ciclo real (transições de `state-machine.ts`; `DONE`/`DEPLOY` **não existem** — o
terminal de sucesso é `COMPLETED`):

```
PENDING → QUEUED → RUNNING → WAITING ⇄ RUNNING
                      │           └─(human, prazo)→ SUSPENDED → PENDING|CANCELLED
                      ├─ RUNNING → REVIEW ──aprovar──▶ COMPLETED
                      │                   └─reabrir──▶ RUNNING|PENDING
                      ├─ FAILED
                      └─ CANCELLED
```

- `REVIEW` é terminal-para-o-agente mas não-terminal-para-o-sistema: aprovar
  (`completeTaskByUser`, exige `status===REVIEW`, `:625`) → (futuro) Master faz o
  merge; reabrir (`retryTask` `:649` / `appendUserMessage` `:672`) → volta a rodar.
- A entrada em `REVIEW` já é **DoD-gated**: a conclusão dispara avaliadores
  independentes (QA/Code Reviewer) antes do handoff (alinhado a PROJECT.md §11);
  o domínio carrega `evaluationVerdict` + `criteria` + `feedback` (`task.ts:94-118`).

| Estado | Decisão | Justificativa |
|--------|---------|---------------|
| `REVIEW` | ✅ **já existe** | Reusar. Falta só pendurar o merge git nele. |
| `SUSPENDED` | ✅ **já existe** | Suspensa por Timeout (PROJECT.md §10.6). |
| `DEPLOY` | **Adiar (opt-in)** | Sem pipeline real é estado morto. |
| `CANCELLED` | ✅ **já existe** | — |

`ponytail:` task sem projeto/sem git vai direto a `COMPLETED` (sem gate de merge);
o gate de merge só se aplica quando há projeto com repo e `autoMerge=false`. Não
criamos passo para quem não precisa.

### 3.4 Credenciais

> ⚠️ **Reconciliação com a realidade.** O desenho `systemd-creds`/`GIT_ASKPASS`
> abaixo é **100% proposta** — `grep git-token\|GIT_ASKPASS\|systemd-creds\|
> LoadCredential src/` retorna vazio; não há `credentials.ts` nem `git-repo.ts`.
> Antes da proposta, o que **já existe** sobre credenciais:

**Duas superfícies de credencial hoje (estado atual):**

1. **Chaves de provider LLM (funcional).** `pi-runner.ts:100-106` monta
   `<PROVIDER>_API_KEY` (ex. `DEEPSEEK_API_KEY`) do ambiente e, se presente, chama
   `auth.setRuntimeApiKey(provider, key)` no AuthStorage **em memória** do Pi SDK.
   Nunca grava em `.swarm`, nunca loga, nunca vai ao chat. O `nunca vazar` do
   PROJECT.md §7 já é honrado **só por esse caminho env-var**.
2. **Campo `apiKey` da rota de settings (inerte).** `routes/settings.ts` guarda
   `providers[].apiKey` num objeto **em memória**, mascarado na leitura
   (`maskApiKey`, `:102-106`). **Mas esse `apiKey` nunca é lido pelo runner** (que
   só lê env) ⇒ hoje é um placeholder de UI, sem efeito em runtime, e não persiste.

**Proposta (credencial git de push) — futura, depende da Fase 3:**

**Não usar HashiCorp Vault** (infra de cluster para um sistema single-host). Usar
a feature **nativa do systemd**: `LoadCredentialEncrypted=`.

- Segredos cifrados com `systemd-creds encrypt` (chave da máquina/TPM), gravados
  fora do sandbox do agente.
- `systemd-run` injeta via `-p LoadCredentialEncrypted=git-token:<arquivo>`; o
  Worker lê de `$CREDENTIALS_DIRECTORY/git-token`. **Nunca** vai para env
  herdável, disco do worktree, log ou chat.
- Git usa o token via `GIT_ASKPASS` (script que ecoa o segredo) ou
  `url.<base>.insteadOf` em memória. Sem `git config` persistente com credencial.
- O Master detém os segredos (`0600`, sob `.swarm/projects/<slug>/credentials/`,
  **fora** dos `ReadWritePaths` do Worker) e os repassa por run.

`ponytail:` systemd-creds + token efêmero por run. Teto: single-host, rotação
manual/curta. Upgrade: secret manager externo **só** com multi-host ou rotação
automática obrigatória.

> Onde `systemd` não existe (dev em macOS/CI): fallback para env var injetada
> apenas no processo filho (`spawn` com `env` restrito). Mesma regra: nunca
> persistir no worktree.

### 3.5 Autenticação e superfície de API ✅ (já implementado)

A versão anterior do doc desconhecia o auth. **Já existe** uma camada de auth de
API opt-in (`middleware/auth.ts`, `http-server.ts:91-93`):

- **Trigger:** `SWARM_AUTH_TOKEN`. Ausente ⇒ no-op (local single-user, sem
  máquina especulativa de sessão/RBAC — coerente com PROJECT.md §1.2).
- **Superfície guardada:** `/api/*` e `/ws`; `/health` e estáticos abertos.
- **Como autentica:** `Authorization: Bearer <token>`; o upgrade `/ws` pode usar
  `?token=<token>` (WS não seta headers).
- **Comparação constant-time** (`crypto.timingSafeEqual`) com guard de tamanho;
  falha → `401 {error:'Unauthorized'}`.
- **Não-objetivos por design:** sem contas de usuário, login, hash de senha,
  sessões ou RBAC.

> Isto é auth de **acesso à API**, **ortogonal** à injeção de credencial git/LLM
> da §3.4. Risco menor: o `?token=` pode aparecer no log de request
> (`request-logger.ts` loga a URL completa); upgrade = header-only ou redação de
> log.

> **Nota:** existe `infrastructure/logging/audit-trail.ts` (JSONL em
> `.swarm/logs/audit.jsonl`) — **código morto**, nunca instanciado. A auditoria
> durável real é o event log (`recordEvent`). Decidir: ligar o AuditTrail a
> eventos de segurança (401, uso de credencial, merge) **ou** removê-lo (YAGNI).
> Ele também monta o path por concatenação de string, **fora do `PathSandbox`** —
> gap contra o DoD#5; não copiar esse padrão no código git/workspace novo.

---

## 4. Modelo de domínio

### 4.1 Projeto

✅ **Store já unificado** (`ProjectFileStore`, injetado na rota). O alvo é só
**migrar o schema**. Modelo atual:

```ts
// project-file-store.ts:11-18 (ATUAL)
interface ProjectData {
  id: string;          // randomUUID (project-file-store.ts:52)
  name: string;
  description: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

Modelo alvo:

```ts
interface ProjectData {
  slug: string;          // id legível, kebab-case (substitui o UUID)
  name: string;
  gitUrl?: string;       // opcional: projeto "doc-only" sem repo
  defaultBranch: string; // ex.: "main"
  autoMerge: boolean;    // default false ⇒ passa por REVIEW
  createdAt: string;
  updatedAt: string;
}
```

**Migração (onde o trabalho realmente mora):**
- **UUID → slug:** existem arquivos `<uuid>.json` em disco e a UI navega por
  `/projects/{id}` (`web/.../ProjectCard.tsx:20`). Trocar o id quebra arquivos e
  rotas existentes — precisa de coexistência/migração, não só de um campo novo.
- **`taskIds` sai do projeto:** a relação passa a ser resolvida pela task
  (`projectIds`), evitando duas listas a sincronizar. Mas a UI hoje deriva
  associação por `taskIds` **ou** um fallback de substring do título
  (`ProjectDetail.tsx:33-37`) — esse heurístico frágil deve **sumir** quando
  `Task.projectIds` for a fonte de verdade.
- **Tombstones:** `deleteProject` grava `''` em vez de `unlink` (`:91-105`); uma
  migração de layout precisa limpar esses arquivos vazios.

`ponytail:` migrar in-place (script de boot que reescreve `<uuid>.json` →
`<slug>/project.json`) em vez de manter dois schemas vivos. Teto: migração única.

### 4.2 Relação Task ↔ Projeto (N:N flexível)

**Única parte do domínio de projetos genuinamente não construída.**

```ts
interface TaskOptions {       // task.ts:45-52 — sem projectIds hoje
  // ...existente
  projectIds?: string[]; // 0 = sem projeto; 1 = comum; N = multi-repo
}
```

Regras:
- 0 projetos → workspace scratch (comportamento atual, `cwd = task dir`).
- 1+ projetos → um worktree por projeto em `workspace/<slug>/`; `cwd` do Worker =
  `.swarm/tasks/<taskId>/workspace/`.
- Subtask herda `projectIds` do pai por padrão (piggyback na árvore que já existe
  via `parentId`/`subtaskIds`/`depth`); pode restringir a um subconjunto.

Pontos de inserção: `TaskOptions` (`task.ts:45-52`), `serialize` (`:233-249`) e
`fromSerialized` (`:251-267`) — **ambos** precisam carregar `projectIds`.

### 4.3 Governança (subsection nova — já implementada)

O `PROJECT.md` §10 (hard ceilings) **já está no domínio** e a versão anterior do
doc o ignorava. `domain/governance.ts` define 7 tetos:

```ts
interface Governance {
  maxCost; maxActiveMs; maxDepth; maxRetries;
  maxTechnicalRetries; maxEpochsWithoutCompletion; maxSubtasksPerTask;
}
```

- Lidos de env (`SWARM_MAX_*`) por `createDefaultGovernance`; capturados como
  **snapshot imutável por run** (`run.ts:13`, `orquestrator.ts:2562`) ⇒ "config
  não afeta runs em voo" (PROJECT.md §1.5).
- ⚠️ **Enforcement dividido (alvo de limpeza):** custo/tempo via snapshot
  (`cardCeiling`, `:3045-3049`); estagnação via `maxEpochsWithoutCompletion`
  (`:2955`). **Mas** `maxDepth` e `maxSubtasksPerTask` são enforçados por
  constantes de módulo (`MAX_TASK_DEPTH`/`MAX_SUBTASKS_PER_TASK`, `:141,869-870,992`),
  **não** pelos campos do snapshot — os campos `maxDepth`/`maxSubtasksPerTask`
  ficam duplicados/inertes. Surfacing como dívida.

### 4.4 Layout de diretórios (ATUAL vs PROPOSTO)

> Raiz real = `<dataDir>/.swarm/` onde `dataDir` default = `~/.kca`
> (`config.ts:32-35`; override `SWARM_DATA_DIR`/`data_dir`). **Não** é `./.swarm/`
> literal. Projetos ainda vivem num root divergente `.kanban-data/projects/`.

**ATUAL (verificado):**

```
<dataDir>/.swarm/                       # default ~/.kca/.swarm/
├── events/current.jsonl               # event log append-only (SSOT)
├── state.snapshot.json (+ .bak)       # projeção reconstruível, version:2
├── logs/audit.jsonl                   # AuditTrail (código morto, fora do sandbox)
└── tasks/
    ├── <taskId>/
    │   ├── task.yml                    # JSON apesar do .yml
    │   ├── chat.jsonl                  # full-rewrite atômico
    │   ├── session.jsonl              # append-only
    │   ├── artifacts.yaml
    │   ├── scope-spec.json            # continuidade (PROJECT.md §3.5)
    │   ├── progress-log.jsonl         # continuidade (append)
    │   ├── env-resume.json            # continuidade
    │   ├── attachments/               # writeAttachment + copyAttachment
    │   └── artifacts/                 # criado lazy no 1º write
    └── _archived/<taskId>/            # archiveTask + purge por idade

<dataDir>/.kanban-data/projects/<uuid>.json   # store divergente, NÃO event-sourced
```

`ensureTaskDir` cria **apenas** `taskDir` + `attachments/`; todo o resto é
on-demand. **Não há `workspace/`.**

**PROPOSTO (Fase 1/2):**

```
<dataDir>/.swarm/
├── projects/<slug>/
│   ├── project.json                   # event-sourced (Fase 0/T0.5)
│   ├── repo.git/                      # mirror clone (object store compartilhado)
│   └── credentials/                   # 0600, FORA do sandbox do Worker
└── tasks/<taskId>/
    └── workspace/<slug>/              # cwd do Worker; git worktree kca/<task>/<sub>
```

---

## 5. Isolamento de processo (Worker como serviço) — *proposto*

> Esta é a maior lacuna entre `PROJECT.md` e o código: hoje a execução é
> **totalmente in-process** (sem fronteira de sandbox; PROJECT.md §3.2/§6
> insatisfeito). A única isolação real hoje é o `PathSandbox` (traversal guard) +
> o `DefaultResourceLoader` do Pi rodado com `noExtensions/noSkills/...`.

### 5.1 Contrato do Worker

Cada run vira um processo transiente. Wrapper fino sobre o `PiSdkAgentRunner`
atual (reuso total da lógica) expondo controle:

| Op | Descrição |
|----|-----------|
| `POST /run`    | inicia a run (config no comando de spawn; idempotente) |
| `POST /cancel` | aborta a run em andamento |
| `GET /health`  | liveness/readiness |
| `GET /events`  | stream (SSE) de output/stats para o Master encaminhar ao event log |

**Transporte: Unix Domain Socket por padrão** (`workspace/.worker.sock`), TCP em
`127.0.0.1:<porta efêmera>` como alternativa. UDS é mais simples (sem colisão de
porta) e mais seguro (permissão de arquivo, sem rede). O Master registra o
endpoint no snapshot para reconectar após restart.

`ponytail:` UDS + `node:http` (sem framework no Worker). Teto: 1-Master↔1-Worker
local. Upgrade: TCP+auth token se algum dia for remoto.

### 5.2 Comando `systemd-run` (limites derivados da governança)

```bash
systemd-run --user --collect --unit=kca-<taskId>-<runId> \
  -p RuntimeMaxSec=<gov.maxActiveMs/1000> \
  -p MemoryMax=2G -p CPUQuota=200% -p TasksMax=512 \
  -p NoNewPrivileges=yes -p PrivateTmp=yes \
  -p ProtectSystem=strict -p ProtectHome=read-only \
  -p ReadWritePaths=<taskDir> \
  -p LoadCredentialEncrypted=git-token:<projects/<slug>/credentials/git-token> \
  --working-directory=<taskDir>/workspace \
  -- node dist/worker/main.js --task=<taskId> --run=<runId> --socket=<...>
```

- `--unit` (serviço transiente nomeado) ⇒ o Master gerencia por nome
  (`systemctl --user stop|status kca-<taskId>-<runId>`).
- `ReadWritePaths` restringe escrita ao diretório da task; `credentials/` fica de
  fora (read via `$CREDENTIALS_DIRECTORY`).
- **Derivar limites da governança:** `RuntimeMaxSec ← gov.maxActiveMs/1000`. O
  systemd cobre tempo/memória/CPU; o **teto de custo (USD/tokens) NÃO tem
  equivalente em systemd** — fica no Master (`BudgetTracker`/`assertWithinCardCeiling`).
  O limite de SO **complementa**, não substitui, o gate de software.
- Cancel em camadas (espelha o `AbortController` atual): `POST /cancel`
  (graceful) e, no fim, `systemctl stop` (hard kill).

Mapeamento explícito governança → systemd (o que o SO cobre e o que continua no Master):

| Governança (`governance.ts`) | Propriedade systemd | Onde enforça |
|---|---|---|
| `maxActiveMs` | `RuntimeMaxSec` | SO (mata a unit) **+** Master (`assertWithinCardCeiling`) |
| `maxCost` (USD) / tokens | — *(sem equivalente)* | **só** Master (`BudgetTracker`) |
| `maxDepth` / `maxSubtasksPerTask` | — | **só** harness (constantes de módulo, ver dívida §4.3) |
| `maxRetries` / `maxTechnicalRetries` / `maxEpochsWithoutCompletion` | — | **só** harness (loop macro) |
| — | `MemoryMax` / `CPUQuota` / `TasksMax` | **só** SO (sem contraparte de software hoje) |

O SO complementa, não substitui, os gates de software: tempo tem dupla guarda; custo e profundidade ficam inteiramente no Master.

### 5.3 Onde isso pluga no código

Hoje **não há concorrência controlada nem timeout enforçado** (§2). Introduzir o
isolamento implica **três** coisas, não só relocar execução:

1. Substituir os **dois** call-sites in-process (`piClient.run` `:1178` e
   `repairInvalidOutput` `:1198`) por um `WorkerSupervisor` (infra), atrás de uma
   interface, **atrás de feature flag** `SWARM_ISOLATION=systemd|inproc` (default
   `inproc`). `SWARM_ISOLATION` **não existe** hoje.
2. **Introduzir um teto de concorrência real** no `pumpQueue` (`:1740`) — hoje
   drena a fila inteira sem limite. (Reaproveitar/reativar o `WorkerPool`, hoje
   vestigial, ou um semáforo simples.)
3. **Restaurar o timeout por run** (hoje morto): armar abort por
   `gov.maxActiveMs`/`RuntimeMaxSec`.

O guard de descarte de run superada (`:1181`/`:1206`/`:1238`) **tem de ser
preservado nos três pontos** através da fronteira de processo: o Master descarta
o resultado da unit se `activeRunId` mudou.

`ponytail:` flag binária, dois modos. Sem plugin system para "runtimes futuros".
Terceiro modo só quando existir terceiro alvo real.

### 5.4 Continuidade através de Workers isolados (ponte §3.3 PROJECT.md)

A peça que torna o isolamento **seguro e fiel ao PROJECT.md** já existe in-process
e precisa apenas ser **preservada**:

- **Desidratar = liberar o Worker.** A unit `systemd` transiente que morre **é** o
  "liberar o worker" do PROJECT.md §3.3. O estado de continuidade
  (`scope-spec.json`, `progress-log.jsonl`, `env-resume.json`) já vive no
  diretório da task — dentro de `ReadWritePaths=taskDir` — então o isolamento já o
  preserva.
- **Reidratar = novo Worker.** O Master injeta `continuity` via `buildPrompt`
  (`orquestrator.ts:1172-1177` → `prompt-builder.ts:67-99`). Um Worker novo
  reconstrói o contexto do ledger.
- **Repair também é Worker.** O re-run de correção de JSON inválido
  (`repairInvalidOutput`, `orquestrator.ts:1198` → `pi-client.ts:183-217`) é uma
  **segunda execução de agente** in-process; no isolamento vira outro Worker
  transiente, sujeito ao **mesmo** contrato de continuidade e ao **mesmo**
  invariante de descarte de run superada (guard `:1206`). Não esquecer o segundo
  call-site ao isolar.
- **Invariante:** **nenhum estado de harness vive no processo Worker.** Tudo
  durável está no card/ledger (PROJECT.md §13.4).
- **Pós-morte do Worker:** o Master reidrata budget + métricas do ledger antes de
  re-spawnar (`reseedBudget` `:2721`; refold de `HEARTBEAT` `:2839`), evitando que
  um restart "zere" o custo acumulado e fure o teto. O `checkpointSeq` do
  `HEARTBEAT` (`:2641`) diz o último checkpoint válido.
- ⚠️ **Modo de falha novo:** se um Worker morre **antes** de fazer flush de
  `run.resultMessages` ao ledger, o monitor de convergência perde um sinal. Logo o
  Worker deve **persistir o resultado ao ledger antes** de o Master considerar a
  unit superada. A detecção de estagnação (`checkForStagnation` `:2953`, lê
  `task.runs[].resultMessages`) e os gates de budget são **cross-Worker por
  construção** — operam no ledger, não no processo.

---

## 6. Fluxo Git fim-a-fim — *proposto*

```
1. Task linkada a projeto P entra em RUNNING.
2. Master garante mirror: .swarm/projects/P/repo.git (clone --mirror 1x; fetch nas próximas).
3. Para cada subtask: Master cria worktree + branch kca/<task>/<sub> a partir de defaultBranch.
4. Worker (systemd-run) executa no worktree; commits locais; push do próprio branch.
5. Manager (papel) reconcilia subtasks → kca/<task> (merge sequencial).
      conflito ⇒ subtask "resolve-conflict" (retry com diff).
6. Gates de governança (budget/ceiling/convergência) passam → applyDecision → REVIEW
      (ou auto-merge se projeto.autoMerge).
7. Aprovação (completeTaskByUser) ⇒ Master faz merge serial kca/<task> → defaultBranch
      (lock por projeto) e push. Rejeição ⇒ retry com feedback.
8. Cleanup: worktrees + branches de subtask mergeados removidos ANTES do archiveTask.
```

O passo 6 reconcilia/mergeia **só depois** dos gates de governança que já rodam
(budget `:1186-1189`, convergência `:1222-1233`), nunca imediatamente na
conclusão. Auditabilidade: cada passo emite `SwarmEvent` (§8); branch e SHA
entram no event log ⇒ rastreável do pedido ao merge.

---

## 7. Impacto no código (arquivos a tocar)

| Fase | Arquivo | Mudança | Estado |
|------|---------|---------|--------|
| 0 | `infrastructure/persistence/project-file-store.ts` | + `slug/gitUrl/defaultBranch/autoMerge`; migrar id UUID→slug; remover `taskIds`; tratar tombstones; path `.swarm/projects/<slug>/` | TODO |
| 0 | `infrastructure/api/routes/projects.ts` | Zod com slug/gitUrl/branch (store **já injetado**) | parcial — só Zod |
| 0 | `domain/task.ts`, `domain/types.ts` | + `projectIds` em `TaskOptions` + `serialize/fromSerialized` | TODO |
| 0 | `domain/types.ts` + CRUD de projeto | eventos `PROJECT_*` + rotear CRUD pelo event log (hoje file-only) | TODO (maior do que parecia) |
| 1 | `infrastructure/persistence/task-file-store.ts` | + `ensureWorkspaceDir`, helper de worktree path (hook em `ensureTaskDir:282`) | TODO |
| 2 | `infrastructure/git/git-repo.ts` *(novo)* | mirror/fetch/worktree/branch/commit/merge (`node:child_process`) | TODO |
| 2 | `application/orquestrator.ts` | hook pré-run (`:1171`, criar worktree) e pós-task (`:1235` `applyDecision`, reconciliar/merge) | TODO |
| 3 | `infrastructure/process/worker-supervisor.ts` *(novo)* | `systemd-run` spawn + lifecycle; interface + impl `inproc` | TODO |
| 3 | `worker/main.ts` *(novo)* | servidor UDS fino sobre `PiSdkAgentRunner` | TODO |
| 3 | `application/orquestrator.ts` | substituir os **2** call-sites (`:1178`,`:1198`); + teto de concorrência no `pumpQueue` (`:1740`); + timeout real | TODO |
| 3 | `infrastructure/config.ts` | flag `SWARM_ISOLATION` (não existe) | TODO |
| 4 | `infrastructure/security/credentials.ts` *(novo)* | `systemd-creds` + fallback env | TODO |
| ~~5~~ | ~~`domain/types.ts` + `task.ts` (REVIEW + máquina)~~ | ✅ **já feito** — `REVIEW`/`SUSPENDED` + `state-machine.ts` | DONE |
| 5 | `infrastructure/api/routes/tasks.ts` | endpoints approve/reject explícitos sobre o `REVIEW` existente | parcial — `completeTaskByUser`/retry já cobrem |

---

## 8. Novos eventos (event-sourcing)

✅ Baseline: **29 tipos** em `SWARM_EVENT_TYPE` (`types.ts:88`). `TASK_REVIEW`,
`TASK_SUSPENDED`, `RUN_TIMEOUT`, `BUDGET_EXCEEDED`, `HEARTBEAT`, `RUN_CANCELLED`,
`TASK_ARCHIVED` **já existem**. Todo evento novo reusa o envelope `SwarmEvent`
(`events.ts:4-25`: `seq/eventId/type/taskId/parentId/runId/waitId/ts/messages/
processedByTaskIds/payload`); pode exigir bump do snapshot `version:2`.

Faltam apenas (git/projeto/worker):

```
PROJECT_CREATED / PROJECT_UPDATED / PROJECT_DELETED   // requer event-sourcing dos projetos
TASK_PROJECT_LINKED { taskId, projectIds }
WORKTREE_CREATED   { taskId, subtaskId, slug, branch, baseSha }
COMMIT_CREATED     { taskId, subtaskId, slug, sha }
BRANCH_MERGED      { from, into, slug, sha }       // Manager→integração, Master→main
TASK_REVIEW_APPROVED / TASK_REVIEW_REJECTED { taskId, by, feedback? }
MERGE_BLOCKED      { taskId, slug, reason: 'conflict'|'lock'|'auth' }
WORKER_SPAWNED / WORKER_EXITED { taskId, runId, unit, code }
```

> `TASK_REVIEW` já existe (lado "requested"). Hoje a aprovação é codificada como a
> transição `REVIEW→COMPLETED` (sem evento dedicado) e a rejeição como retry
> (`TASK_RETRIED`). Adicionar `APPROVED/REJECTED` é **refinamento**, não greenfield.
>
> ⚠️ Projetos **não são event-sourced hoje** (file-only). `PROJECT_*` exige
> também rotear o CRUD pelo event log + projeção no snapshot, espelhando tasks —
> mais trabalho do que um item de uma linha.

---

## 9. Backlog executável (fases → tasks → DoD)

> Cada fase é independente, entregável e reversível. DoD por task = a coisa menor
> que falha se a lógica quebrar. Tamanho alvo: 1 PR pequeno, verde no CI.

### Fase 0 — Modelo de Projeto + N:N *(sem Git, sem processo)*

> ⚠️ **T0.5 é o item mais pesado da fase**, não um ajuste de schema: hoje projetos
> persistem só em arquivo (não event-sourced). Trazê-los ao SSOT = nova rota de
> CRUD pelo event log **+** projeção no snapshot (replay reconstrói o projeto),
> espelhando o que tasks já fazem. O DoD de fase ("event-sourced, sobrevive a
> restart por replay") depende dele — não subestimar.

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T0.1 | Estender `ProjectData`: `slug/gitUrl?/defaultBranch/autoMerge`, migrar id UUID→slug, remover `taskIds`, limpar tombstones, path `.swarm/projects/<slug>/project.json` | `project-file-store.ts` | Teste: cria/lê/atualiza com novos campos; slug duplicado rejeitado; corrupt→null; arquivos UUID antigos migrados |
| T0.2 | Validar/gerar `slug` (kebab-case, único) | `project-file-store.ts` | Teste: `"My App"→"my-app"`; colisão lança erro |
| ~~T0.3~~ | ~~Trocar `Map` por `ProjectFileStore` na rota~~ | — | ✅ **FEITO** (`http-server.ts:130`); resta só ampliar o Zod (slug/gitUrl/branch) em `routes/projects.ts:7-17` |
| T0.4 | `projectIds?: string[]` em `TaskOptions` + `serialize/fromSerialized` | `task.ts:45-52,233-267`, `types.ts` | Teste: round-trip preserva `projectIds`; default `[]` |
| T0.5 | Eventos `PROJECT_*`/`TASK_PROJECT_LINKED` + **rotear CRUD de projeto pelo event log** + projeção no snapshot | `types.ts`, `project-file-store.ts`, `snapshot-store.ts` | `recordEvent` emite; **replay a partir do log reconstrói projeto + link** (não só leitura de arquivo) |
| T0.6 | UI: campos slug/gitUrl/branch no form + seletor multi-projeto na task; **remover** o fallback de substring (`ProjectDetail.tsx:33-37`) | `web/` | Manual: criar projeto com git, linkar 0/1/N; associação por `projectIds` |

> UI base **já existe** (`web/.../projects/`: Grid, Card, Dialog, Detail; CRUD via
> `api/client.ts:108-138`). T0.6 só adiciona campos git + seletor e remove o
> heurístico — não reconstrói os componentes.

### Fase 1 — Workspace isolado por task

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T1.1 | `ensureWorkspaceDir(taskId)` + helper de path de worktree | `task-file-store.ts` (hook em `ensureTaskDir:282`) | Teste: cria `workspace/`; sandbox rejeita traversal |
| T1.2 | `cwd` do agente = `workspace/` (via `getTaskDir`/resolver, propagar aos sites de pi-client) | `orquestrator.ts:1083`, `pi-client.ts:94,170,206` | Teste: run recebe `cwd=workspace`; escrita fora rejeitada pelo sandbox |

### Fase 2 — Integração Git (worktrees + merge)

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T2.1 | `GitRepo` wrapper (`node:child_process`): `ensureMirror/fetch/worktreeAdd/worktreeRemove/branch/commit/merge` | `infrastructure/git/git-repo.ts` *(novo)* | Teste em repo tmp: mirror 1x, worktree add/remove, commit, merge ff e 3-way |
| T2.2 | Hook pré-run: worktree+branch `kca/<task>/<sub>` de `defaultBranch` | `orquestrator.ts:1171` | Teste: subtask roda em worktree próprio; `WORKTREE_CREATED` com `baseSha` |
| T2.3 | Reconciliação Manager → `kca/<task>` (merge sequencial) | `orquestrator.ts:1235` (`applyDecision`, ramo `completed`) | Teste: 2 subtasks → integração com ambos commits; ordem determinística |
| T2.4 | Conflito → subtask `resolve-conflict` (retry com diff) | `orquestrator.ts` | Teste: merge conflitante emite `MERGE_BLOCKED{reason:conflict}` + cria subtask |
| T2.5 | Merge serial Master → `defaultBranch` com lock por projeto | `orquestrator.ts` + `git-repo.ts` | Teste: 2 tasks no mesmo projeto não mergeiam concorrente; 1 escritor em main |
| T2.6 | Cleanup: `worktree remove` + `branch -D` antes do `archiveTask` | `git-repo.ts`, coordenar `task-file-store.ts:218` | Teste: após terminal, sem worktrees/branches órfãos; `worktree prune` no boot |
| T2.7 | Eventos git | `domain/types.ts` | Replay reconstrói SHA/branch de cada passo |

### Fase 3 — Isolamento de processo (systemd-run)

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T3.1 | `worker/main.ts`: `node:http` sobre UDS, `run/cancel/health/events`, reusa `PiSdkAgentRunner` | `worker/main.ts` *(novo)* | Teste: `/run` executa e `/events` faz stream; `/cancel` aborta |
| T3.2 | `WorkerSupervisor` (interface) + `SystemdSupervisor` + `InprocSupervisor` | `infrastructure/process/worker-supervisor.ts` *(novo)* | Teste: `inproc` idêntico ao atual; `systemd` spawna unit (skip se indisponível) |
| T3.3 | Flag `SWARM_ISOLATION=systemd\|inproc` (default `inproc`) | `config.ts` | Teste: env override; default seguro |
| T3.4 | Substituir os **2** call-sites (`:1178` run, `:1198` repair) pelo supervisor, preservando o guard nos **3** pontos (`:1181/:1206/:1238`) | `orquestrator.ts` | Teste: output de unit superada descartado (invariante `activeRunId`) |
| T3.5 | **Teto de concorrência real** no `pumpQueue` (`:1740`) via nova env `SWARM_MAX_CONCURRENT_RUNS` (default 4; hoje **não existe** — concorrência é ilimitada) + **timeout real** por run (derivado de `gov.maxActiveMs`/`RuntimeMaxSec`) | `orquestrator.ts`, `worker-pool.ts`, `config.ts` | Teste: N+1 runs enfileiram quando N=teto; run que excede o tempo é abortada |
| T3.6 | Limites systemd (`RuntimeMaxSec←gov.maxActiveMs`, `MemoryMax/CPUQuota/ReadWritePaths`) + cancel via `systemctl stop` | `worker-supervisor.ts` | Manual: estourar memória mata a unit; cancel encerra |
| T3.7 | Reconexão pós-restart: snapshot guarda unit/socket; boot reidrata budget/métricas (`reseedBudget`) e reconcilia | `orquestrator.ts`, `snapshot-store.ts` | Teste: restart com run ativa não duplica execução nem zera custo |

### Fase 4 — Credenciais seguras

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| T4.1 | `credentials.ts`: resolver token via `$CREDENTIALS_DIRECTORY` (systemd) + fallback env | `infrastructure/security/credentials.ts` *(novo)* | Teste: lê de dir simulado; ausência → erro claro |
| T4.2 | `GIT_ASKPASS` script + `LoadCredentialEncrypted` no spawn | `worker-supervisor.ts`, `git-repo.ts` | Teste: push autentica; sem credencial em `git config` |
| T4.3 | Garantia anti-vazamento | — | Teste: `grep -r <token> .swarm` vazio; token ausente de log/chat/worktree |

### Fase 5 — Gate de merge sobre o `REVIEW` existente

> ✅ `REVIEW`/`SUSPENDED` + máquina de transição **já existem** (`state-machine.ts`,
> `task.ts:221-231`). A fase encolheu: foca **só** no merge git e nos eventos
> approve/reject.

| ID | Task | Arquivos | DoD |
|----|------|----------|-----|
| ~~T5.1~~ | ~~`REVIEW` em `TASK_STATUS` + transições~~ | — | ✅ **FEITO** (`types.ts:10`, `state-machine.ts:35-40`) |
| T5.2 | Eventos `TASK_REVIEW_APPROVED/REJECTED` (refina o `TASK_REVIEW` existente) | `domain/types.ts` | Replay reconstrói o veredito de review |
| T5.3 | Endpoints approve/reject explícitos sobre `completeTaskByUser`/retry | `routes/tasks.ts` | Teste de rota: approve → merge Master; reject → retry com feedback |
| T5.4 | `autoMerge` opt-in pula o gate de merge | `orquestrator.ts` | Teste: `autoMerge=true` mergeia direto; `false` para em REVIEW |
| T5.5 | UI: botões approve/reject no board (coluna REVIEW já existe) | `web/` | Manual: aprovar/rejeitar pelo board |

`DEPLOY`: fora do backlog até existir destino de deploy real (§3.3).

---

## 9.1 Definition of Done

**DoD de task** (toda task acima só fecha com):
1. Código en-US, comentários pt-BR, kebab-case (CODE_GUIDELINE).
2. ≥1 teste runnável que falha se a lógica quebrar (o menor possível; sem
   framework novo).
3. `pnpm lint && pnpm typecheck && pnpm test` verdes.
4. Eventos novos persistidos **e** reconstruídos por replay (event-sourcing
   intacto); usar o envelope `SwarmEvent` (§8).
5. Nenhuma operação de I/O fora do `PathSandbox`. *(Nota: o `AuditTrail` viola
   isso hoje — não copiar o padrão; rotear pelo sandbox se for usado.)*
6. `graphify update` rodado após alteração estrutural.

**DoD de fase** (gate para a próxima):
- Fase 0: projeto com slug/gitUrl/branch criado, **event-sourced**, e linkado
  0/1/N; sobrevive a restart por replay.
- Fase 1: agente escreve só dentro do `workspace/`; escape rejeitado.
- Fase 2: 2 subtasks concorrentes mergeiam sem corrida; conflito vira subtask;
  merge final 1x em main; SHA no log.
- Fase 3: run em unit transiente com limites; **teto de concorrência e timeout
  realmente enforçados** (não eram); cancel encerra; `inproc` idêntico; restart
  não duplica nem zera custo.
- Fase 4: token nunca em log/chat/worktree/`git config`; push autentica; grep
  vazio.
- Fase 5: task com projeto não auto-merge para no gate de merge; approve mergeia;
  reject reabre.

**DoD da feature** (entrega completa):
- As 4 perguntas (§12) respondidas em código, não só em doc.
- Trilha de auditoria do pedido ao merge reconstruível por replay.
- Modo `inproc` mantém dev/CI funcionando sem systemd.
- `docs/software` e `docs/usage` atualizados.

---

## 10. Riscos e mitigação

| Risco | Mitigação |
|------|-----------|
| **Concorrência hoje é ilimitada** (`pumpQueue` sem teto) | Fase 3 introduz teto real; **não** assumir que `WorkerPool` já controla (é vestigial) |
| **Timeout por run não enforça hoje** | Fase 3 restaura abort por `gov.maxActiveMs`/`RuntimeMaxSec` |
| **Dois call-sites in-process** (run + repair) | Isolar ambos; preservar o guard nos 3 pontos |
| **Worker morre antes de flush** ⇒ convergência perde sinal | Worker persiste `run.resultMessages` ao ledger antes de o Master superar a unit |
| **Restart zera custo acumulado** | `reseedBudget` + refold de `HEARTBEAT` no boot antes de re-spawnar |
| `systemd-run --user` indisponível (mac/CI) | Flag `inproc` como fallback de 1ª classe |
| Conflitos de merge frequentes | Subtask de resolução + merge sequencial |
| Lock por projeto vira gargalo | Upgrade: fila de merge + rebase auto |
| Vazamento de credencial | `systemd-creds`, fora de `ReadWritePaths`, `GIT_ASKPASS`, teste de grep |
| **`?token=` em log de request** | Header-only ou redação no `request-logger` |
| Worktree órfão após crash | `git worktree prune` no boot + replay; remover antes do `archiveTask` |
| **Projetos fora do SSOT** (file-only) | T0.5 event-sourcea projetos |
| Mirror clone gigante | Upgrade: partial clone `--filter=blob:none` |

---

## 11. Decisões adiadas (YAGNI / ponytail)

- **HashiCorp Vault** — adiado; `systemd-creds` cobre single-host.
- **Estado `DEPLOY`** — adiado até pipeline real.
- **Multi-host / pool remoto de Workers** — adiado; UDS local resolve.
- **Plugin system de runtimes** — adiado; 2 modos (`systemd`/`inproc`) bastam.
- **Fila de merge sofisticada** — adiado; lock serial por projeto basta.
- **Partial/shallow clone** — adiado; mirror simples até disco doer.
- **Eventos `TASK_REVIEW_APPROVED/REJECTED` dedicados** — adiado se a transição
  `REVIEW→COMPLETED`/retry já bastar para a auditoria; adicionar só quando o
  veredito precisar de payload próprio (by/feedback).
- **Limpeza da duplicação de governança** (`maxDepth`/`maxSubtasksPerTask` inertes
  no snapshot vs constantes de módulo) — adiado, mas registrado (§4.3).

---

## 12. Resumo das respostas

1. **Merge**: só o **Master** escreve no branch protegido; Manager reconcilia
   subtasks; Worker nunca toca `main`. Default = abrir integração + `REVIEW`
   (estado **já existente**), não auto-merge. *(git proposto)*
2. **Concorrência**: 1 mirror por projeto, 1 worktree+branch por subtask, merge
   sequencial. ⚠️ Atenção: a concorrência de **runs** hoje é ilimitada — o
   isolamento precisa introduzir o teto, não só relocar execução.
3. **Estados**: `REVIEW`, `SUSPENDED`, `CANCELLED` e a máquina de transição **já
   existem**; só falta o **gate de merge** sobre `REVIEW`. `DEPLOY` adiado.
4. **Credenciais**: hoje, chaves LLM via `<PROVIDER>_API_KEY` env (em memória, não
   vazam) + auth de API bearer-token (`SWARM_AUTH_TOKEN`). Para git: proposta
   `systemd-creds`/`LoadCredentialEncrypted` + `GIT_ASKPASS`; Vault só com
   multi-host.
