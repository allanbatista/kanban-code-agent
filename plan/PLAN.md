# PLAN — Implementação do PROJECT.md (Swarm de Agentes para Kanban Agêntico)

> **Objetivo deste plano.** Levar a base atual (`src/` backend event-sourced + `web/` frontend + agentes Pi) ao patamar conceitual descrito em [`PROJECT.md`](../PROJECT.md): um Swarm de agentes long-running governado por *Harness Engineering* e *Loop Engineering*, com Kanban como SSOT, **filesystem como banco de dados**, comunicação **orientada a eventos sem deadlock**, e avaliação independente. Tudo precisa estar **muito bem testado** (mocks determinísticos de LLM/agentes + e2e front↔backend↔agent) e cada fase só fecha após a skill **`ponytail-review`**.
>
> Este plano foi construído a partir de leitura direta do código **e** de um mapeamento multi-agente (10 agentes) de cada conceito do PROJECT.md contra a implementação atual.

---

## 0. Como ler este plano

- O índice de fases está na seção 3. O detalhamento de cada fase vive em [`plan/fases/{nn}-{slug}.md`](./fases/).
- Cada **fase** e cada **task** carrega um **estado**: `pending` · `running` · `fail` · `done`.
- A fonte de verdade do estado é o cabeçalho (`status:`) de cada arquivo de fase e a tabela de tasks dentro dele. A seção 3 replica o resumo.

### Legenda de estados

| Estado | Significado |
| --- | --- |
| `pending` | Ainda não iniciada. |
| `running` | Em execução / parcialmente entregue. |
| `fail` | Tentada mas bloqueada/quebrada — exige correção antes de prosseguir. |
| `done` | Concluída **e** com Definition of Done satisfeita (inclui `ponytail-review`). |

> Convenção: a fase só vira `done` quando **todas** as tasks estão `done` e os critérios de saída (incl. `ponytail-review`) passaram. Uma task em `fail` trava a fase.

---

## 1. Estado atual (baseline) — o que já existe

A base é **madura**; o plano **fecha lacunas**, não recomeça. Resumo apurado por leitura do código + mapeamento dos 10 agentes:

**Sólido e funcionando (285 testes passando, 18 arquivos):**
- **Event-sourcing / SSOT** — log append-only (`event-store.ts`, `.swarm/events/current.jsonl`), snapshots como projeção, replay + recuperação pós-crash (`loadState`/`replayEventsMinimal`/`recoverStatusesAfterCrash`).
- **Filesystem como banco** — `task-file-store.ts`, `project-file-store.ts`, `atomic-writer.ts` (escrita atômica), `sandbox.ts` (PathSandbox), chat/artefatos/anexos por task.
- **Ciclo de vida** — `PENDING · QUEUED · RUNNING · WAITING · REVIEW · COMPLETED · FAILED · CANCELLED`.
- **Comunicação event-driven sem deadlock (§9)** — wait groups (`WAIT_ALL`/`ON_DEMAND`), detecção de ciclo (`waitGraphReachable`), self-wait guard, despertar assíncrono por eventos terminais. **Já resolve o deadlock Pai–Filho de dados.**
- **Guarda anti-vitória-prematura** — `coerceToWait`: `completed` com subtasks pendentes é coagido a `WAITING`.
- **Retry + escalonamento de modelo/effort por decisão do agente** — `retryCount`/`technicalRetryCount`.
- **Tetos** — profundidade (`MAX_TASK_DEPTH`), budget **global** de tokens/custo, timeout de run.
- **API + tempo real** — Fastify HTTP, WebSocket, rotas tasks/events/agents/projects/settings/reports.
- **Seam de mock de LLM já invertido** — `PiAgentClient` consome um `AgentRunner` injetável (`pi-client.ts`); mocks determinísticos são triviais (`makeRoutedRunner` já existe em `orquestrator.test.ts`). **Esta é a alavanca de todos os testes.**
- **Frontend** — `web/` (React+Vite+shadcn) com client/adapter/ws-client e testes próprios.
- **Provider de validação já é o default** — `config.ts`: `fast`/`balanced` → `deepseek/deepseek-v4-flash`, `deep` → `deepseek/deepseek-v4-pro`.

**Lacunas vs. PROJECT.md (o que este plano entrega):**

| # | Lacuna | Ref. | Onde |
| --- | --- | --- | --- |
| L1 | **Sem máquina de estados no domínio** — transições são campo mutável livre, sem tabela/guardas; lógica espalhada no orquestrator | §4 | `domain/task.ts`, `orquestrator.ts` |
| L2 | **Estado “Suspensa por Timeout” ausente**; `WAITING` não distingue subtask de humano/dependência | §4, §10.6 | `domain/types.ts` |
| L3 | **Sem monitor de convergência/estagnação** (Δ(epoch_n, n−1) < θ); runs não são rotulados como epochs com sinal de progresso | §5.3, §10.3 | `orquestrator.ts` |
| L4 | **Avaliação independente (QA + Code Reviewer) não é gate automático** — conclusão é auto-declarada | §8.2, §11 | `orquestrator.ts`, `agents/index.ts` |
| L5 | **DoD não imposta** — sem checagem de regressão, sem consolidação de memória, fechamento de árvore implícito | §11 | `orquestrator.ts` |
| L6 | **Sem artefatos de continuidade formais** (scope-spec verificável, progress-log, env-resume) nem rotina de orientação nem contrato de Task | §3.3, §3.5, §5.1, §9.1 | persistence, `orquestrator.ts` |
| L7 | **Replay é “minimal”, não um fold determinístico** — snapshot e replay podem divergir; sem teste de equivalência | §3.3 | `orquestrator.replayEventsMinimal` |
| L8 | **Sem fluxo “perguntar a humano/pai” + escalonamento + timeout-park** — a comunicação deve usar **o chat** (já é o canal); faltam só a tool `ask_human`, `WAITING(human)` e o timeout | §9.3, §10.6 | domain, orquestrator, API, web |
| L9 | **Budget é só em-memória e global** — reseta no restart; sem tetos por-card de custo **e** tempo ativo | §10.5 | `budget-tracker.ts` |
| L10 | **Sem heartbeats** entre epochs com métricas de consumo | §3.6 | orquestrator, ws |
| L11 | **SSE não espelha o WS** — emite `events.slice(-1)[0]` em `state:changed`, perdendo a maioria dos eventos (fallback quebrado) | §3.6 | `api/routes/events.ts:29,100` |
| L12 | **Definições de agente duplicadas** em `orquestrator-factory.ts` **e** `agents/index.ts`; guardrails (must/must-not) não codificados | §8.3 | ambos |
| L13 | **Registro de modelos inconsistente** — `orquestrator.ALLOWED_MODELS` (openrouter) ≠ `config.ts` (deepseek) | §1.5 | `orquestrator.ts`, `config.ts` |
| L14 | **`ProjectFileStore` órfão** — não ligado a `routes/projects.ts`; projetos não sobrevivem a restart (US-6 falsa) | — | `routes/projects.ts` |
| L15 | **Sem e2e real front→backend→agent→filesystem→WS** — testes drivam o Orquestrator direto; a borda HTTP/WS nunca foi exercida | §2.2 | testes |
| L16 | **`PROJECT.md` e `web/` não versionados** (untracked) | — | git |
| L17 | **Effort=high sem caminho de configuração explícito** para validação (effort vive em `runtimeConfig`, não em `SwarmConfig`) | §8.2 | `config.ts`, harness |
| L18 | **Data-root com dois nomes** (`~/.kca` dataDir + subdir `.swarm`) — esclarecer/unificar e documentar | — | `config.ts`, persistence |
| L19 | **Auth reivindicada (commit 149aeab) mas ausente no servidor** — decidir implementar ou adiar conscientemente | — | API |
| L20 | **WS sem catch-up no reconnect** — reenvia só snapshot; eventos perdidos durante a desconexão (`TASK_ARCHIVED`, `HEARTBEAT`, deltas de chat); `seq` está no fio mas é ignorado; sem unsubscribe/resubscribe multiplexado | §3.6 | `ws-server.ts`, `web/.../ws-client.ts` |
| L21 | **Appends de chat não-evented** — feedback técnico (`orquestrator.ts:1399-1403`) e instrução de retry (`1220-1225`) não emitem `MESSAGE_APPENDED`; replay-from-events-only perde chat/artefatos | §3.3 | `orquestrator.ts` |
| L22 | **Humano não anexa artefatos mid-conversa** — só na criação (path-based, sem upload real); `appendUserMessage` não aceita anexos; sem endpoint multipart | §3.5 | `orquestrator.ts`, `routes/tasks.ts`, web |
| L23 | **Artefatos do agente sem endpoint de conteúdo nem render** — `create_artifact`/`ARTIFACT_CREATED` existem, mas não há `GET .../artifacts/:file`, o front não renderiza/baixa, e não entram na DoD/review | §11 | `routes/tasks.ts`, web, `orquestrator.ts` |
| L24 | **Resume da sessão do agente é regressão vs. POC** — `pi-client.ts:161,183` passam `sessionManager: undefined`; `piSessionFile` é código morto; o prompt tem instrução pendente de “continuar sessão”; sem checkpoint intra-epoch; tools (`create_artifact`/`post_message`) não-idempotentes na retomada (duplicam efeitos) | §3.6 | `pi-client.ts`, `pi-runner.ts`, `orquestrator.ts` |

---

## 2. Restrições transversais (valem para TODAS as fases)

1. **Definition of Done inclui `ponytail-review`.** Antes de marcar uma fase `done`, executar a skill `ponytail-review` sobre o diff da fase e endereçar (ou justificar com comentário `ponytail:`) cada achado de over-engineering. Sem isso a fase **não fecha**.
2. **Validação com DeepSeek v4 flash, effort high.** A suíte de validação “viva” (não-mock) roda com `provider=deepseek`, `modelId=deepseek-v4-flash`, `effort=high`. É **opt-in** (gated por `DEEPSEEK_API_KEY` / `SWARM_VALIDATION=1`) e **skippada** em CI sem chave. Todos os demais testes ficam **offline/determinísticos**.
3. **Tudo testado, com mocks determinísticos de LLM/agente.** Reutilizar o seam: `AgentRunner` injetado (`pi-client.ts`) via `OrquestratorDeps`. **Nunca** importar o SDK Pi em código de teste/aplicação nem bater num provider real em testes unit/integration.
4. **E2e de verdade por capacidade que cruza a borda.** Servidor Fastify real + cliente WS real + `AgentRunner` fake + filesystem em `tmpdir`. Valida o tripé **front ↔ backend ↔ agent** e a persistência (eventos no log, snapshot, arquivos da task).
5. **Filesystem como banco / auditável.** Toda transição de estado ou ação de governança emite **`SwarmEvent` append-only** (replayável). Proibido estado durável escondido em memória que quebre rehydration.
6. **Compatibilidade de persistência.** Qualquer mudança no shape serializado de Task/evento faz round-trip por `fromSerialized` e não quebra replay de fixtures on-disk existentes.
7. **Convention over configuration; envvar > file.** Seguir `docs/software/CODE_GUIDELINE.md`: named exports, arquivos kebab-case, constantes UPPER_SNAKE, padrão de `config.ts`.
8. **Sem regressão.** `npm test` (vitest, backend `src/**` **e** `web/**`) verde, `npm run typecheck` e `npm run lint` limpos como pré-condição de qualquer fase `done`.
9. **Graphify.** Após grandes alterações, `graphify update` (regra do projeto).
10. **O chat é a única interface agente↔humano.** Pergunta do agente, resposta do humano, progresso, resultado e artefatos vivem sempre no log de chat da task (`MESSAGE_APPENDED`). Os eventos **apenas orquestram estado** (`WAITING(human)`, `SUSPENDED`, timeout) — **proibido** canal/objeto paralelo de pergunta/resposta. Tudo que entra no chat (incl. appends de retry e anexos) **emite evento** para o replay-from-events-only ser fiel.
11. **Realtime com durabilidade.** O WS é o canal near-realtime; cada evento do ledger chega ao cliente **com `seq`**, e o reconnect faz **catch-up por `sinceSeq`** (nenhum evento perdido na desconexão). SSE é fallback que **espelha** o WS.

### Concerns transversais confirmados (respondem perguntas de design recorrentes)

Verificados no código por mapeamento multi-agente; cada um tem dono explícito no plano:

| Concern | Hoje | Onde no plano |
| --- | --- | --- |
| **Front↔back via WebSocket near-realtime** | push por evento funciona, mas **sem catch-up no reconnect** e `seq` ignorado | F0.T6 (ordem por `seq`), F7.T1/T5 (parity + catch-up) |
| **Tudo orientado a evento** | núcleo event-sourced; **2 appends de chat bypassam** o log (L21) | constraint #5/#10, F2.T1 (fold completo + fechar bypasses) |
| **Chat é a única interface agente↔humano** | chat já é o canal; **faltam** tool `ask_human` + `WAITING(human)` | constraint #10, **F6 (reescrita)**, F7.T2 (HITL no chat) |
| **Humano adiciona artefatos** | só na criação (path-based); **nada mid-conversa** (L22) | F6.T4 (upload + mid-conversa, evented), F7.T2 (UI) |
| **Agente gera artefatos como resposta** | engine ok (`create_artifact`); **sem endpoint/render/DoD** (L23) | F7.T6 (endpoint+render), F5.T4 (DoD), F8 (e2e) |
| **Retomada do agente após restart** | status recovery ok; **sessão Pi não resume** (regressão vs POC), sem checkpoint intra-epoch, tools não-idempotentes (L24) | F2.T6 (sessão), F3.T5 (checkpoint), F4.T5 (idempotência) |

### Pontos de validação front ↔ backend ↔ agent ↔ filesystem (mapa-mestre)

| Fronteira | O que validar | Camada |
| --- | --- | --- |
| **Front → Backend** | criar/mover/cancelar/retry/responder task via HTTP; payloads validados (zod) na borda | `web/src/api/*` ↔ `api/routes/*` |
| **Backend → Front** | eventos em tempo real (WS **e** fallback SSE espelhando o WS); cada evento do ledger chega ao cliente | `ws-server.ts`/`routes/events.ts` ↔ `web/src/api/ws-client.ts` |
| **Backend → Agent** | resolução de runtimeConfig (model/effort) e contrato de decisão (`AgentDecision`) | `pi-client.ts`, `decision-parser.ts` |
| **Agent → Backend** | parse/validação da saída; coerção a WAITING; subtask idempotente; veredito de avaliação | `orquestrator.applyDecision`, `decision-parser.ts` |
| **Backend ↔ Filesystem** | append no log, snapshot == replay-fold, arquivos da task atômicos, budget persistido | persistence/*, `atomic-writer.ts` |
| **Recuperação** | replay/crash-recovery reconstrói o mesmo estado (property test) | `loadState`/replay-fold |

---

## 3. Índice de Fases

| Fase | Slug / arquivo | Objetivo | Depende de | Status |
| --- | --- | --- | --- | --- |
| **F0** | [`00-baseline-and-harness`](./fases/00-baseline-and-harness.md) | Fixar o verde; versionar `PROJECT.md`+`web/`; unificar registro de modelos (L13) e data-root (L18); ligar `ProjectFileStore` (L14); extrair **harness de mock+servidor reutilizável**; **primeiro e2e real**; plug de validação DeepSeek effort=high (L17) | — | `pending` |
| **F1** | [`01-domain-state-machine`](./fases/01-domain-state-machine.md) | Máquina de estados no domínio: tabela de transições + guardas, estado **`SUSPENDED`** (timeout), `WAITING` diferenciado (subtask/humano), `failureReason` (L1, L2) | F0 | `pending` |
| **F2** | [`02-ssot-replay-and-continuity`](./fases/02-ssot-replay-and-continuity.md) | Log como SSOT com **replay-fold determinístico** (snapshot vira cache derivável) + **artefatos de continuidade** (scope-spec/DoD-checklist, progress-log, env-resume) + **contrato de Task** + **reidratação seletiva** (L6, L7) | F0, F1 | `pending` |
| **F3** | [`03-convergence-and-epochs`](./fases/03-convergence-and-epochs.md) | **Epochs** com sinal de progresso + **monitor de convergência/estagnação** (§5.3) + **escalonamento automático** de modelo/effort (L3) | F0, F1 | `pending` |
| **F4** | [`04-per-card-ceilings`](./fases/04-per-card-ceilings.md) | **Tetos por-card** de custo **e** tempo ativo + **budget persistido/reidratado** (sobrevive a restart) + catálogo de condições de parada (§10) (L9) | F0, F1 | `pending` |
| **F5** | [`05-independent-evaluation-and-dod`](./fases/05-independent-evaluation-and-dod.md) | **Gate de avaliação independente** QA + Code Reviewer (separado do gerador) + **unificação das definições de agente** com guardrails + **imposição da DoD** (§8.2, §11) (L4, L5, L12) | F0, F1, F2 | `pending` |
| **F6** | [`06-comms-and-human-in-the-loop`](./fases/06-comms-and-human-in-the-loop.md) | **Pergunta filho→pai + escalonamento** em escopo isolado (§9.3) + **pergunta/resposta humana** front↔back↔agent + **timeout-park → `SUSPENDED`** (L8) | F0, F1, F2, F5 | `pending` |
| **F7** | [`07-heartbeats-telemetry-and-ui`](./fases/07-heartbeats-telemetry-and-ui.md) | **Heartbeats** (§3.6) + **correção SSE↔WS** (L11) + frontend: UI dos novos estados, HITL, telemetria de budget/heartbeat, árvore de subtasks, teste de contrato (L10, L11) | F0, F1, F4, F6 | `pending` |
| **F8** | [`08-e2e-coverage-and-validation`](./fases/08-e2e-coverage-and-validation.md) | **Cobertura HTTP/WS** + decisão de **auth** (L19) + retry manual + validação de frame WS + **Cenário A completo (§12)** ponta a ponta + **run de validação viva** (deepseek-v4-flash, effort high) | F0–F7 | `pending` |

> Ordem pensada por dependência: o **estado** (F1) e o **SSOT/replay + continuidade** (F2) vêm antes das fases de governança que mudam o shape serializado (F3/F4), reduzindo o risco de divergência de ledger. F5 (avaliação) antes de F6 (HITL) reduz regressões de conclusão prematura. F7 expõe tudo na UI; F8 sela com o cenário completo e a validação viva.

---

## 4. “Definition of Done” por fase (gabarito)

Toda fase replica este checklist na sua seção *Critérios de saída*:

- [ ] Todas as tasks da fase em `done`.
- [ ] `npm test` (vitest backend **e** `web/`) verde — incluindo os novos testes mock e e2e da fase.
- [ ] `npm run typecheck` e `npm run lint` limpos.
- [ ] Pelo menos **1 teste e2e** exercitando a capacidade pela borda real (HTTP/WS) com agente mockado + asserts no ledger/filesystem.
- [ ] Round-trip de serialização / replay-equivalência onde o shape mudou.
- [ ] Pontos de validação front↔backend↔agent relevantes à fase cobertos.
- [ ] **`ponytail-review` executada** sobre o diff da fase; achados endereçados ou marcados com `ponytail:`.
- [ ] (Se aplicável) `graphify update` após alterações grandes.
- [ ] Run de validação viva (DeepSeek v4 flash, effort high) revisada nas fases que tocam o caminho real do provider (mínimo: F0 e F8).

---

## 5. Riscos globais

- **Confiar em “done” do `.sdd`/`.changelog`.** Features marcadas prontas (ex.: push WS) estavam silenciosamente quebradas. O e2e de F0 é obrigatório antes de construir por cima.
- **Drift de shape de persistência.** F1/F2/F3/F4 mudam o shape serializado de Task/evento. Sem testes de round-trip `fromSerialized` e equivalência de replay, ledgers on-disk podem divergir ou falhar na reidratação.
- **Over-engineering contra a ética ponytail.** Tentação de construir um subsistema de memória indexada genérico, framework de idempotência ou DSL de scope-spec elaborada. Manter cada artefato/guarda mínimo, reusar padrões existentes (event log, `TaskFileStore`, seam `AgentRunner`); `ponytail-review` em cada diff.
- **Suposições que expiram (§1.2).** Andaimes (avaliador pesado, reset, contrato) podem virar sobrecusto conforme o modelo melhora — marcar cada um com `ponytail:` + nota de reavaliação e torná-los configuráveis/desligáveis.
- **Determinismo da detecção de estagnação (F3).** Sinal de progresso mal escolhido gera falso-negativo (nunca dispara) ou falso-positivo (mata iteração produtiva). Sinal barato, estável e validado por testes produtivo-vs-circular.
- **Drift de contrato front↔back (F7/F8).** O shape de evento WS escrito à mão pode quebrar a board a qualquer rename. Teste de contrato com fixture capturada que falha no CI é essencial.
- **Correção de budget no restart (F4).** Re-semear o gasto a partir de `task.metrics` ao restaurar precisa bater com o gate vivo, senão um card fura o teto pós-restart sem teste pegar.
- **Custo/flakiness do provider real (F8).** A validação viva deve ser network-gated e fora do CI default para manter as suítes rápidas e offline.
- **Dois fontes de verdade para a conversa.** Tentação de modelar pergunta/resposta como objeto/endpoint próprio (a versão anterior do F6 fazia isso). Manter o **chat** como fonte única; eventos só orquestram estado. Caso contrário, UI e ledger divergem sobre a mesma conversa.
- **Catch-up de reconnect incorreto (F7.T5).** Se o replay por `sinceSeq` não bater com o stream ao vivo, o cliente fica em estado inconsistente sem perceber. Exigir teste “desconecta+emite N+reconecta == sempre-conectado” e detecção de gap por `seq`.
- **Resume de sessão meio-implementado (F2.T6).** Hoje `piSessionFile`/prompt de sessão são andaime morto (regressão vs POC). A decisão reabrir-vs-reidratar deve ser **completa** — implementar o resume real **ou** remover o dead code; não deixar a instrução de prompt mentindo.
- **Efeitos colaterais duplicados na retomada (F4.T5).** Sem chaves de idempotência, um restart no meio da epoch duplica artefatos/mensagens. Cobrir com teste de crash-após-side-effect + re-run.
</content>
