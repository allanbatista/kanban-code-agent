---
fase: F2
slug: 02-ssot-replay-and-continuity
status: pending
depends_on: [F0, F1]
---

# F2 — Log como SSOT (Replay-Fold) + Artefatos de Continuidade + Contrato (§3, §5.1, §9.1)

**Status da fase:** `pending`
**Objetivo:** Fazer do event log a **fonte única de verdade** com um **fold de replay determinístico** (snapshot vira cache derivável e verificável), e adicionar os **artefatos de continuidade** que o §3.5 exige — *scope-spec* verificável (que também é o **contrato de Task** do §9.1), *progress-log*, *env-resume* — injetados na **reidratação seletiva** por uma fatia de “working set” limitada, em vez do chat inteiro.
**Depende de:** F0, F1.

## Por que esta fase

O sistema desidrata/reidrata de fato (worker liberado ao fim do run; estado nos arquivos; replay na carga), mas (a) o replay é **“minimal”**, não um fold completo — snapshot e replay podem **divergir** sem ninguém perceber (L7); e (b) faltam os artefatos de **alto sinal** do §3.5: a lista verificável de escopo (antídoto à vitória prematura), a narrativa de progresso e o procedimento de retomada de ambiente. Esta fase precede as fases de governança (F3/F4) porque elas mudam o shape serializado — o fold + round-trip protegem contra divergência de ledger.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F2.T1 | Replay-fold determinístico **completo** (status + chat + artefatos); snapshot == replay (property test) | `pending` |
| F2.T2 | Artefatos de continuidade: scope-spec/DoD-checklist + progress-log + env-resume | `pending` |
| F2.T3 | Contrato de Task: acordar “pronto” antes de executar (§9.1) | `pending` |
| F2.T4 | Reidratação seletiva: fatia de working-set + injeção dos artefatos | `pending` |
| F2.T5 | Testes mock + e2e de continuidade (retomada reconstrói fatia mínima) | `pending` |
| F2.T6 | **Decisão e implementação: resumo durável da sessão Pi (reabrir vs. reidratar)** | `pending` |

### F2.T1 — Replay-fold determinístico **completo**  ·  `pending`
- **O que:** Substituir `replayEventsMinimal` por um **fold puro** `state = events.reduce(apply, empty)` que reconstrói o mesmo estado do snapshot — **incluindo chat e artefatos**, não só status. Hoje há divergência confirmada: no branch com snapshot, `loadState:1757-1763` recarrega o chat de arquivo, mas `replayEventsMinimal:1797-1834` (branch sem snapshot) **só** dobra status — um rebuild puramente-do-ledger **perde chat/artefatos** (exatamente L7). O fold deve reconstruir `task.chat` de `MESSAGE_APPENDED` (+ payloads de `RUN_COMPLETED`/`TASK_REVIEW`/`TASK_COMPLETED`) e `task.artifacts` de `ARTIFACT_CREATED`. Snapshot vira **cache derivável**. **Fechar bypasses de chat não-evented:** o append de feedback técnico (`orquestrator.ts:1399-1403`) e o de instrução de retry (`1220-1225`) hoje **não** emitem `MESSAGE_APPENDED` (o texto vai só ao `chat.jsonl`) — emitir o evento (ou incluir o texto no payload de `TASK_RETRY_REQUESTED`) para o fold reconstruir. Adicionar **idempotência de `MESSAGE_APPENDED` no fold** (dedupe por `eventId`/`ts`), já que eventos passam a ser a fonte do chat.
- **Toca:** `src/application/orquestrator.ts` (`loadState`/replay, os 2 appends não-evented), possível `src/application/replay.ts` (fold puro).
- **Testes (mock):** rebuild **events-only** (sem snapshot, sem `chat.jsonl`) == `restoreFromSnapshot` para **status, chat e artefatos** (property/fuzz leve); todo call-site de `appendChat` tem evento pareado cujo payload contém a linha; replay de fixture on-disk existente não quebra.
- **DoD:** log é SSOT auto-suficiente; snapshot reconstruível por fold completo; nenhum append de chat bypassa o ledger. `ponytail:` reusar `fromSerialized`, sem novo formato.

### F2.T2 — Artefatos de continuidade  ·  `pending`
- **O que:** Persistir por card, no ledger/filesystem: (a) **scope-spec** — decomposição do objetivo numa **lista verificável** de capacidades, inicialmente “não-atendidas” (cada item vira critério da DoD de F5); (b) **progress-log** — narrativa concisa do que cada epoch fez/decidiu/descobriu; (c) **env-resume** — como subir e exercer o ambiente num teste básico. Reusar `task-file-store` + eventos (auditável).
- **Toca:** `src/infrastructure/persistence/task-file-store.ts`, `orquestrator.ts`, prompts.
- **Testes (mock):** após epoch, scope-spec marca itens atendidos; progress-log recebe entrada; arquivos atômicos.
- **DoD:** artefatos persistidos, versionados, reconstruíveis por replay.

### F2.T3 — Contrato de Task (§9.1)  ·  `pending`
- **O que:** Antes de executar, o executor propõe **o que vai construir e como verificar sucesso**; um avaliador (Produto/Architecture conforme rota) revisa; iteram até concordar; só então constrói. O artefato acordado **é o scope-spec** de F2.T2. Implementar como sub-turno **opcional** (configurável por política — andaime `ponytail:`).
- **Toca:** `orquestrator.ts`, prompts, `decision-parser.ts` (contrato de proposta).
- **Testes (mock):** contrato proposto→revisado→aceito gera scope-spec; rejeição itera.
- **DoD:** “pronto” acordado e persistido antes do trabalho; auditável; desligável.

### F2.T4 — Reidratação seletiva  ·  `pending`
- **O que:** Ao reidratar, injetar a **fatia mínima de alto sinal** (scope-spec + progress-log + próximo item + env-resume + cauda de chat limitada), respeitando `MAX_PROMPT_CHAT_MESSAGES`, em vez do histórico bruto. É a **rotina de orientação** (§5.1) na prática.
- **Toca:** `src/application/prompt-builder.ts`, `orquestrator.ts` (montagem do contexto reidratado).
- **Testes (mock):** prompt de card reidratado contém scope-spec + progress-log + próximo item; **não** contém o histórico bruto completo.
- **DoD:** contexto reidratado é o “menor conjunto de tokens de alto sinal”.

### F2.T5 — Testes de continuidade  ·  `pending`
- **O que:** Simular descontinuidade entre turnos: rodar epoch 1 (mock), recriar o orquestrator (rehydrate via fold), afirmar que o sucessor retoma do scope-spec/progress-log **sem reconstruir tudo** e escolhe o próximo item. 1 e2e: matar e religar o servidor (harness F0) e ver a task seguir coerente.
- **Toca:** `src/__tests__/application/continuity.test.ts` (novo), `src/__tests__/e2e/rehydrate.e2e.test.ts` (novo).
- **Testes:** este é o teste.
- **DoD:** retomada reconstrói a fatia mínima e progride; e2e de rehydrate verde.

### F2.T6 — Resumo durável da sessão Pi: reabrir vs. reidratar  ·  `pending`
- **Contexto (regressão vs. POC):** Hoje a sessão Pi **não** é persistida nem reaberta — `pi-client.ts:161,183` passam `sessionManager: undefined` e `pi-runner.ts:117` sempre cria `SessionManager.inMemory()`. O campo `task.piSessionFile` é **código morto** (só atribuído no deserialize, `task.ts:201`) e `prompt-builder.ts:54-57` carrega uma instrução **pendente** (“Continue a partir do histórico anterior da sessão”) que o código nunca cumpre. A continuidade pós-restart hoje é **só textual** (chat reinjetado no prompt). A POC fazia resume real (`poc/index.ts:488-507`: `SessionManager.open(sessionPath)` + grava `piSessionFile`).
- **O que:** **Decidir explicitamente** entre (a) **reabrir a sessão Pi persistida** (rota POC: persistir `piSessionFile`, `SessionManager.open(taskDir/session.jsonl)`, reinjetar no run, gravar `task.piSessionFile = session.sessionFile` ao fim) — satisfaz §3.6 “retoma do último checkpoint válido”; ou (b) **reidratação textual** (rota atual) — então **remover o andaime morto**: campo `piSessionFile`, a linha enganosa do prompt (`prompt-builder.ts:54-57`), `metadata.sessionFile` e `saveSession` (`task-file-store.ts:74`). Não deixar meio-implementado.
- **Toca:** `src/application/pi-client.ts`, `src/cli/pi-runner.ts`, `src/domain/task.ts`, `src/application/prompt-builder.ts`, `src/infrastructure/persistence/task-file-store.ts`.
- **Testes (mock + validação viva):** se (a), run pós-restart **continua** a sessão anterior (teste afirma delta de tokens menor que re-run completo); se (b), o prompt deixa de mencionar sessão e nenhum campo morto resta.
- **DoD:** decisão tomada e **totalmente** implementada (sem dead code). `ponytail:` favorecer (b) salvo se a validação viva (F0.T7) mostrar que (a) reduz tokens/turno de forma significativa — o checkpoint intra-epoch fica em F3.T5.

## Pontos de validação cobertos

- **Recuperação / Backend↔Filesystem:** replay-fold == snapshot; continuidade real entre instâncias.
- **Backend→Agent:** contexto reidratado mínimo e de alto sinal.
- **Persistência:** round-trip de artefatos novos.

## Critérios de saída (DoD da fase)

- [ ] F2.T1…F2.T6 em `done`.
- [ ] Log é SSOT; replay-fold **completo** (status+chat+artefatos) == restore de snapshot (property test verde); nenhum append de chat bypassa o ledger.
- [ ] scope-spec/DoD-checklist + progress-log + env-resume persistidos e usados na orientação.
- [ ] Contrato de Task disponível e configurável (`ponytail:` andaime reavaliável).
- [ ] Decisão de sessão Pi (reabrir vs. reidratar) tomada e **totalmente** implementada — sem `piSessionFile`/prompt mortos.
- [ ] `npm test` verde (mock + e2e de rehydrate); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
</content>
