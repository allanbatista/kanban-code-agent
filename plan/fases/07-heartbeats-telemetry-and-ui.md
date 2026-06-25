---
fase: F7
slug: 07-heartbeats-telemetry-and-ui
status: done
depends_on: [F0, F1, F3, F4, F6]
---

# F7 — Heartbeats, Paridade SSE↔WS e Frontend (Observabilidade em Tempo Real)

**Status da fase:** `done` (implementado 2026-06-24 — ver PLAN.md §7.5 e DEFERRED.md para cortes conscientes)
**Objetivo:** Expor toda a governança nova na UI e corrigir o contrato de streaming: emitir **`HEARTBEAT`** entre epochs com tokens/custo/tempo acumulados (§3.6), **corrigir o SSE** para espelhar o WS (hoje quebrado, L11), e completar o frontend — afordância de **HITL** (responder pergunta), indicadores de **budget vs teto**, telemetria de cache/heartbeat, **lanes de `FAILED`/`SUSPENDED`**, árvore de subtasks/workflow, edição de título persistida e ações de review.
**Depende de:** F0, F1, F4, F6.

## Por que esta fase

O Kanban é a interface visual **e** o SSOT — a UI precisa refletir o ledger fielmente para o usuário “observar todo o processo até a entrega” (objetivo do AGENTS.md). Faltam heartbeats (L10) e o **SSE está quebrado** — emite `orquestrator.events.slice(-1)[0]` em `state:changed` (`routes/events.ts:29,100`), perdendo a maioria dos eventos (o WS usa o emitter `'event'` por evento). E o frontend foi construído contra o contrato anterior; F1–F6 estenderam estados/eventos que a UI ainda não mostra.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F7.T1 | Evento `HEARTBEAT` + paridade SSE↔WS via serializador compartilhado (incl. replay) | `pending` |
| F7.T2 | Frontend: UI dos novos estados + HITL **pelo chat** + render/anexo de artefatos do humano | `pending` |
| F7.T3 | Frontend: telemetria (budget/teto, cache, heartbeat) + árvore de subtasks | `pending` |
| F7.T4 | Teste de contrato WS front↔back + 1 cliente WS por mount + unsubscribe/resubscribe | `pending` |
| F7.T5 | **Catch-up no reconnect (`sinceSeq`) + garantia de ordem por `seq`** | `pending` |
| F7.T6 | **Endpoint HTTP de artefato + render/download no chat + integridade + retenção** | `pending` |
| F7.T7 | **`/health` enriquecido (worker pool, fila, disco, tasks ativas)** | `pending` |
| F7.T8 | **Smoke de UI em browser real (Playwright): board, drawer, chat HITL, anexo, artefato** | `pending` |

### F7.T1 — Heartbeats + paridade SSE↔WS  ·  `pending`
- **O que:** Emitir `HEARTBEAT` entre epochs com métricas acumuladas (tokens/custo/tempo); propagar via WS. **Corrigir o SSE** para emitir os mesmos eventos de domínio do WS (assinar o emitter `'event'`, não `slice(-1)` de `state:changed`), via um **serializador de evento compartilhado** entre WS e SSE (fonte única do payload). O serializador deve servir **tanto o emitter ao vivo quanto o replay de catch-up** (de F7.T5).
- **Toca:** `orquestrator.ts`, `src/domain/events.ts`, `src/infrastructure/api/ws-server.ts`, `src/infrastructure/api/routes/events.ts`, serializador comum.
- **Testes (mock + e2e):** epoch emite heartbeat; **SSE e WS entregam a mesma sequência** de eventos — incluindo uma **janela de desconexão+reconexão** (não só steady-state): SSE `Last-Event-ID` e WS `sinceSeq` entregam a mesma sequência perdida.
- **DoD:** heartbeats observáveis; SSE == WS (bug corrigido), inclusive no caminho de replay.

### F7.T2 — UI dos novos estados + HITL pelo chat + anexos  ·  `pending`
- **O que:** Renderizar `REVIEW`, `WAITING(subtasks)` vs `WAITING(human)`, `SUSPENDED`, `FAILED(failureReason)` com badges/colunas. **HITL ancorado no chat (coerente com F6):** quando `status==WAITING(human)`, **destacar a última mensagem `assistant` (a pergunta) inline no `TaskChatPanel`** e responder pelo **compositor de chat existente** (`sendMessage` → `POST /messages`) — **sem** widget/endpoint `/answer` separado; reagir a `MESSAGE_APPENDED` + `TASK_RESUMED`. **Anexos do humano:** afordância de anexar arquivo no `CreateTaskDialog` e no `TaskChatPanel` (upload via endpoint multipart de F6.T4) e **renderização de `message.attachments`** nas bolhas do chat (hoje não são renderizadas).
- **Toca:** `web/src/components/kanban/{StatusBadge,KanbanBoard,TaskCard,AgentColumn,TaskDrawer,TaskChatPanel,CreateTaskDialog}.tsx`, `web/src/types/task.ts`, `web/src/api/client.ts`, kanbanStore (`sendMessage`/`createTask` multipart).
- **Testes:** componente renderiza cada estado novo; a pergunta pendente aparece destacada no chat e a resposta sai pelo compositor; anexo enviado na criação e mid-chat aparece no histórico; estado atualiza com `MESSAGE_APPENDED`/`TASK_RESUMED`.
- **DoD:** todos os estados do §4 visíveis; **humano responde pelo chat** (não por widget dedicado) e o agente retoma; humano anexa arquivos pela UI e os vê no chat.

### F7.T3 — Telemetria em tempo real  ·  `pending`
- **O que:** Exibir budget/custo **por-card vs teto** (de F4), heartbeats (tokens/custo/tempo) e cache no detalhe da task; renderizar a **árvore de subtasks/workflow** (já há `WorkflowView`/`TaskNode`) refletindo wait groups e estados. Consumir frames `HEARTBEAT`/`BUDGET_EXCEEDED`.
- **Toca:** `web/src/components/kanban/{TaskSummaryPanel,TaskHistoryPanel}.tsx`, `web/src/components/workflow/*`.
- **Testes:** telemetria atualiza ao chegar heartbeat; workflow reflete dependências e estados.
- **DoD:** usuário observa consumo, tetos e topologia em tempo real.

### F7.T4 — Teste de contrato WS + higiene de conexão  ·  `pending`
- **O que:** Teste de **contrato** com fixture capturada do payload de evento do backend, que **falha no CI** se o shape divergir do que o `client.ts`/`ws-client.ts` espera (anti-drift, risco global). **Versionar o schema de evento** (`schemaVersion: 1` no envelope WS/SSE, Rev2-M6): o teste de contrato falha se a versão mudar sem migração. Garantir **um único cliente WS por mount** e wiring 100% real (sem dados mock em runtime). Suportar uma mensagem `unsubscribe` real e **resubscribe por `taskId` sem derrubar o socket**; no reconnect, **resubscribe à task atualmente vista** (não à capturada na criação do client, `ws-client.ts:145`).
- **Toca:** `web/src/**/__tests__/*`, fixture compartilhada de contrato, `web/src/hooks/useWebSocket.ts`, `web/src/api/ws-client.ts`, `src/infrastructure/api/ws-server.ts` (tipo de mensagem `unsubscribe`).
- **Testes:** contrato; trocar a task assinada e verificar o alvo de subscription pós-reconnect; nenhum dado mock em runtime.
- **DoD:** contrato front↔back guardado; subscription multiplexável e correta pós-reconnect; 1 cliente WS por mount.

### F7.T5 — Catch-up no reconnect + ordem por `seq`  ·  `pending`
- **O que:** Hoje, no reconnect, o servidor só reenvia o **snapshot de estado** — eventos perdidos durante a desconexão (ex.: `TASK_ARCHIVED`, `HEARTBEAT`, deltas de chat) **somem** (o `seq` existe no fio, `ws-client.ts:19`, mas é ignorado). Implementar **cursor de retomada**: o cliente envia `{type:'subscribe', taskId, sinceSeq}` e o servidor **reenvia os eventos com `seq>sinceSeq`** antes/no lugar do snapshot — nenhum evento se perde. **Fonte do replay = o `EventStore` durável (por `seq`)**, não só o buffer `orquestrator.events` em memória — assim o catch-up funciona **mesmo após restart do servidor** (o buffer em memória é reconstruído na carga, mas o store é a verdade). Se o gap exceder o que o store consegue servir, cair para **snapshot + flag de gap**. O cliente rastreia o maior `seq` aplicado, detecta gaps e pede resync. **SSE em paridade via o mecanismo nativo `Last-Event-ID`** (reconnect do `EventSource` envia o header automaticamente; o servidor faz o mesmo replay por `seq`).
- **Toca:** `src/infrastructure/api/ws-server.ts`, `src/infrastructure/api/routes/events.ts`, `src/infrastructure/persistence/event-store.ts` (leitura por `seq>cursor`), `web/src/api/ws-client.ts`.
- **Testes (e2e):** matar o socket no meio do fluxo, emitir N eventos com ele caído, reconectar → cliente termina em **estado idêntico** a um que ficou conectado; **reiniciar o servidor** e reconectar com `sinceSeq` → catch-up vem do store; injeção de gap força resync.
- **DoD:** zero eventos perdidos no reconnect (incl. pós-restart); ordem garantida por `seq`; SSE usa `Last-Event-ID`. `ponytail:` ler do `EventStore` por `seq`, sem store novo.

### F7.T6 — Endpoint de artefato + render/download + integridade  ·  `pending`
- **O que:** O agente já cria artefatos (`create_artifact`→`ARTIFACT_CREATED`), mas **não há como buscar o conteúdo** nem renderizá-lo. (1) Adicionar `GET /api/tasks/:id/artifacts` (lista) e `GET /api/tasks/:id/artifacts/:fileName` (stream do conteúdo) em `routes/tasks.ts`, resolvendo via `task-file-store` contra `.swarm/tasks/:id/artifacts/`, **revalidando o path pelo `PathSandbox`** (bloqueia traversal), com `Content-Type` do `fileType` e `Content-Disposition` para download. (2) **Integridade:** em `createArtifact` (`orquestrator.ts:948-963`), commitar evento/snapshot **só após** o write do arquivo; reconcile no replay que sinaliza/dropa entradas de `artifacts.yaml` sem arquivo. (3) **Frontend:** substituir o placeholder de `TaskChatPanel.tsx:66-71` por um **card de artefato** com link de download e render inline (markdown via ReactMarkdown, código via `SyntaxHighlighter`); lista de artefatos com download no `TaskSummaryPanel`; contador clicável no `TaskDrawer`.
- **Retenção (M5, database-as-filesystem):** definir política de **limpeza/expiração** — artefatos/anexos de famílias **arquivadas** (via `archiveByStatus`, que já move para `_archived`) podem ser purgados após retenção configurável (`SWARM_ARTIFACT_RETENTION_DAYS`) e/ou limite de tamanho por task; sem cleanup, o disco é o limite.
- **Toca:** `src/infrastructure/api/routes/tasks.ts`, `orquestrator.ts`, `task-file-store.ts` (purge/retenção), `web/src/components/kanban/{TaskChatPanel,TaskSummaryPanel,TaskDrawer}.tsx`, `web/src/api/client.ts`.
- **Testes (integração + e2e):** rotas de artefato (Fastify inject) incl. 200 stream, Content-Type/Disposition corretos, 404 para arquivo inexistente, 400/403 para traversal; UI abre e baixa todo artefato; purge respeita a retenção e não toca famílias ativas.
- **DoD:** artefatos do agente buscáveis por HTTP, íntegros, renderizados/baixáveis no chat; política de retenção aplicada. `ponytail:` retenção = um varredor no archive existente, sem GC novo.

### F7.T7 — `/health` enriquecido + métricas de sistema  ·  `pending`
- **O que (M2, §10 “falhar de forma observável”):** Já existe `GET /health` (`http-server.ts:103`) mínimo. Enriquecer com status operacional: tamanho do worker pool / slots ocupados, tamanho da fila, tasks ativas/aguardando, uso de disco do dataDir. Hoje o sistema é caixa-preta para o operador — sem isso, problemas só aparecem quando tasks estagnam.
- **Toca:** `src/infrastructure/api/http-server.ts` (ou `routes/reports.ts`), `orquestrator.ts` (expor contadores).
- **Testes (integração):** `/health` retorna os campos; reflete fila/slots sob carga simulada.
- **DoD:** operador enxerga saúde do sistema. `ponytail:` estender o handler existente, sem dashboard novo.

### F7.T8 — Smoke de UI em browser real (Playwright)  ·  `pending`
- **O que (Rev3-Média-3, §2.2 “verificar exercendo, não inspecionando”):** Os testes de componente (vitest/jsdom) não exercem a UI pesada num browser. Adicionar **um smoke Playwright** contra o servidor real (harness F0 + agentes mock): abrir o board, abrir o `TaskDrawer`, ver o chat, responder uma pergunta HITL, anexar um arquivo, abrir/baixar um artefato. Gated/opt-in se o browser não estiver no CI.
- **Toca:** `web/e2e/smoke.spec.ts` (novo, Playwright), `web/playwright.config.ts`.
- **Testes:** este é o teste.
- **DoD:** fluxo crítico da UI validado num browser real. `ponytail:` 1 spec de smoke, não uma suíte E2E de UI completa.

## Pontos de validação cobertos

- **Backend→Front:** heartbeats, perguntas (no chat), estados e artefatos renderizados; **SSE == WS**; **catch-up no reconnect sem perda**.
- **Front→Backend:** resposta humana (pelo chat) e ações de task atravessam a borda validadas.
- **Contrato:** shapes do client batem com a API (teste que falha no CI ao divergir); ordem por `seq`.

## Critérios de saída (DoD da fase)

- [ ] F7.T1…F7.T8 em `done`.
- [ ] `HEARTBEAT` entre epochs; SSE equivalente ao WS (bug L11 corrigido), inclusive no replay; envelope com `schemaVersion`.
- [ ] `/health` enriquecido; smoke Playwright do fluxo crítico verde; retenção de artefatos aplicada.
- [ ] **Catch-up no reconnect (`sinceSeq`)**: nenhum evento perdido na desconexão; ordem por `seq`; subscription correta pós-reconnect.
- [ ] Frontend expõe HITL **pelo chat**, anexos do humano, render/download de artefatos do agente, telemetria budget/teto/cache/heartbeat, lanes `FAILED`/`SUSPENDED`, edição de título persistida e ações de review.
- [ ] Teste de contrato WS protege contra drift; 1 cliente WS por mount; sem mocks em runtime.
- [ ] `cd web && npm test` verde + `npm run build` ok; `npm test` (root) sem regressão; `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff (incl. front); achados endereçados/justificados.
