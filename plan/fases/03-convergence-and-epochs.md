---
fase: F3
slug: 03-convergence-and-epochs
status: pending
depends_on: [F0, F1]
---

# F3 — Epochs, Monitor de Convergência/Estagnação e Escalonamento (§5.3, §10.3)

**Status da fase:** `pending`
**Objetivo:** Tornar o loop **seguro contra estagnação**: rotular runs como **epochs** com um **sinal de progresso**, detectar loops circulares (Δ(epoch_n, n−1) < θ) e quebrá-los para `FAILED(reason=stagnation)` **antes** de esgotar o contador de retry, e adicionar uma **escada de escalonamento automático** de modelo/effort (fast→balanced→deep, sobe effort) em falhas repetidas.
**Depende de:** F0, F1.

## Por que esta fase

Grep: 0 ocorrências de `convergen`/`stagnat`/`epoch`. O orquestrator tem retry, mas repete a mesma abordagem malsucedida com variações triviais consumindo orçamento (§2.2 “loops de estagnação”). Falta o **monitor de convergência** (§5.3) e o conceito de **epoch** como unidade de medição/decisão (§3.6). O escalonamento hoje só acontece se o agente **pedir** retry com novo model/effort; falta o automático.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F3.T1 | Contador de epoch + sinal de progresso por run | `pending` |
| F3.T2 | Monitor de convergência: Δ < θ ⇒ `FAILED(stagnation)` antes do teto de retry | `pending` |
| F3.T3 | Escada de escalonamento automático model/effort | `pending` |
| F3.T4 | Testes mock de estagnação (produtivo vs circular) + escalonamento | `pending` |
| F3.T5 | **Checkpoint por epoch + retomada do último checkpoint válido (§3.6)** | `pending` |

### F3.T1 — Epochs + sinal de progresso  ·  `pending`
- **O que:** Rotular cada run com um número de **epoch** e computar um **sinal de progresso** barato e estável (ex.: hash normalizado de `resultMessages` + instruções, ou contagem de itens do scope-spec recém-atendidos de F2). Persistir no run (auditável).
- **Toca:** `src/domain/run.ts`, `orquestrator.ts` (`getOrCreateExecutionRun`, applyDecision).
- **Testes (mock):** epochs incrementam; sinal muda quando há progresso real.
- **DoD:** epoch + sinal persistidos e observáveis.

### F3.T2 — Monitor de convergência  ·  `pending`
- **O que:** Comparar o sinal entre epochs consecutivas. Se a magnitude da mudança cair abaixo de `θ` (`SWARM_CONVERGENCE_THETA`) por `N` (`SWARM_STAGNATION_EPOCHS`) tentativas, transicionar para `FAILED` com `failureReason='stagnation'` (de F1), emitir evento e alertar supervisor — **antes** de esgotar `MAX_TASK_RETRIES`. Distinguir iteração produtiva (muda abordagem) de circular (varia trivialmente). **Guarda adicional (PF4):** estagnação **não** cobre o caso de “progressão sem fim” — o agente gera estratégias **novas** que todas falham (o sinal muda, mas nunca converge para `completed`). Checar também o teto **`maxEpochsWithoutCompletion`** (definido em F4.T1, §10.3 “esgotar tentativas de autocorreção”): epochs demais sem chegar a `completed` ⇒ `FAILED(reason='attempts', subtipo='max_epochs')`. Distinto de `MAX_TASK_RETRIES` (que é por-run) e da estagnação (que é por-similaridade).
- **Toca:** `orquestrator.ts` (caminho de retry/reabertura), `src/application/convergence.ts` (função pura de similaridade).
- **Testes (mock):** outputs quase-idênticos disparam estagnação em N epochs; outputs **divergentes mas sempre falhos** disparam `max_epochs` (não estagnação); outputs divergentes e produtivos não disparam nenhum.
- **DoD:** estagnação **e** “max epochs sem completar” detectadas e paradas limpas/observáveis. `ponytail:` heurística simples (edit-distance/Jaccard), **sem** libs de NLP; nomear teto e via de upgrade.

### F3.T3 — Escalonamento automático model/effort  ·  `pending`
- **O que:** Em falhas técnicas repetidas (ou reprovações de F5), subir automaticamente a config: `fast→balanced→deep` e/ou `effort` um nível, dentro dos modelos permitidos. Captura a intuição do §3.2 (dar mais capacidade quando o turno simples não converge), respeitando os tetos. **Backoff temporal já existe** (`RETRY_BASE_DELAY_MS * technicalRetryCount`, `orquestrator.ts:1416`); o escalonamento **reusa** esse backoff (não duplicar) — só garantir que a escalada de model/effort também respeite o atraso crescente.
- **Toca:** `orquestrator.ts` (`handleRunFailure`/reabertura).
- **Testes (mock):** sequência de falhas escala model/effort de forma determinística com backoff crescente; teste captura a config aplicada e o atraso.
- **DoD:** escalonamento automático e auditável, com backoff existente; configurável/desligável.

### F3.T4 — Testes de parada limpa  ·  `pending`
- **O que:** Suíte focada: estagnação (produtivo vs circular), escalonamento, e **parada limpa** (sem runs RUNNING órfãos, ledger íntegro). 1 e2e: card que estagna é reportado via WS como `FAILED(stagnation)`.
- **Toca:** `src/__tests__/application/convergence.test.ts` (novo), `src/__tests__/e2e/stagnation.e2e.test.ts` (novo).
- **Testes:** este é o teste.
- **DoD:** paradas limpas/observáveis comprovadas por mock + 1 e2e.

### F3.T5 — Checkpoint por epoch + retomada do último checkpoint válido  ·  `pending`
- **O que:** A epoch (F3.T1) é a unidade natural de checkpoint (§3.6). Persistir um **checkpoint ao fim de cada epoch** (contador + ponteiro do último estado válido) de modo que um restart re-agende a partir do **último checkpoint válido**, não do início do trabalho do card. Hoje `recoverStatusesAfterCrash` (`orquestrator.ts:1854-1867`) reseta `RUNNING→PENDING` e o re-run recomeça a epoch do zero (sem checkpoint intra-epoch — um crash a 90% refaz 100%). Emitir evento de checkpoint observável.
- **Toca:** `src/application/orquestrator.ts` (`recoverStatusesAfterCrash` respeita o checkpoint), `src/domain/events.ts`.
- **Testes (mock):** crash no meio de uma sequência de epochs retoma da epoch N (não da 1); mata/recria o orquestrator a meio caminho e afirma retomada a partir do checkpoint.
- **DoD:** restart retoma do último checkpoint válido, não do início. `ponytail:` checkpoint = ponteiro no run/evento, sem store novo; depende da decisão de sessão Pi (F2.T6) para o nível de granularidade real.

## Pontos de validação cobertos

- **Agent→Backend:** sequência de decisões estagnadas detectada e barrada.
- **Backend↔Filesystem:** paradas emitem eventos auditáveis; sem runs órfãos no snapshot/replay-fold.
- **Backend→Front:** `failureReason='stagnation'` chega à UI (telemetria de F7).

## Critérios de saída (DoD da fase)

- [ ] F3.T1…F3.T5 em `done`.
- [ ] Epochs rotulados com sinal de progresso.
- [ ] Monitor de convergência quebra loops circulares para `FAILED(stagnation)` antes do teto de retry; `θ`/`N` configuráveis.
- [ ] Escalonamento automático de model/effort entre tentativas.
- [ ] Restart retoma do último checkpoint válido (epoch N), não do início do card.
- [ ] `npm test` verde (mock + e2e); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; heurística marcada com `ponytail:` (teto + upgrade).
</content>
