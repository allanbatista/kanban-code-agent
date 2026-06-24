---
fase: F1
slug: 01-domain-state-machine
status: pending
depends_on: [F0]
---

# F1 — Máquina de Estados da Task no Domínio (§4)

**Status da fase:** `pending`
**Objetivo:** Tornar o modelo de estados do §4 **cidadão de primeira classe no domínio**: uma tabela de transições com guardas/invariantes, o estado faltante **`SUSPENDED`** (Suspensa por Timeout), `WAITING` **diferenciado** (subtask vs humano/dependência) e um discriminador `failureReason` em `FAILED`. Assim as fases seguintes (estagnação, tetos, HITL, DoD) têm estados legais para onde transicionar.
**Depende de:** F0.

## Por que esta fase

Hoje `task.status` é um campo público mutável sem guarda; toda a lógica de transição vive espalhada no `orquestrator.ts` (L1). Faltam: o estado **`SUSPENDED`** (§4/§10.6, L2), a distinção de **por que** a task espera (subtask vs humano — hoje colapsadas em `WAITING`), e o motivo da falha (exaustão vs estagnação vs teto). Sem isso, F4/F6 não têm onde estacionar o card nem como rotular paradas.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F1.T1 | Tabela de transições + `setStatus` guardado no domínio | `pending` |
| F1.T2 | Estado `SUSPENDED` + `WaitGroup.deadline`; `WAITING` diferenciado (subtask/humano) | `pending` |
| F1.T3 | `failureReason` em `FAILED` + invariante de cancelamento em cascata | `pending` |
| F1.T4 | Round-trip de serialização + testes de todas as transições | `pending` |

### F1.T1 — Tabela de transições + guardas  ·  `pending`
- **O que:** Definir uma tabela declarativa de transições legais (objeto const) e um `setStatus(to, reason?)` que a consulta e **lança em transição ilegal**. Os call-sites do orquestrator passam a usar o setter guardado em vez de atribuir `task.status` diretamente nos pontos sensíveis. Mantém invariantes (ex.: só `REVIEW`→`COMPLETED` por usuário/aprovação; `*`→`CANCELLED`).
- **Toca:** `src/domain/task.ts` (ou `src/domain/state-machine.ts` novo), call-sites em `orquestrator.ts`.
- **Testes (mock):** tabela-verdade de transições válidas/inválidas; transição ilegal rejeitada.
- **DoD:** transições legais centralizadas e testadas. `ponytail:` tabela const simples, **sem** framework de FSM.

### F1.T2 — `SUSPENDED` + `WAITING` diferenciado  ·  `pending`
- **O que:** Adicionar `SUSPENDED: 'SUSPENDED'` a `TASK_STATUS` (não-terminal, reversível) + eventos `TASK_SUSPENDED`/retomada. Adicionar `waitingReason: 'subtasks' | 'human'` ao metadata (derivado do run/wait) e `deadline?` ao `WaitGroup` (insumo do timeout de F6). Garantir que `isTerminalTaskStatus` **não** trate `SUSPENDED` como terminal e que `recoverStatusesAfterCrash` o preserve.
- **Toca:** `src/domain/types.ts`, `src/domain/task.ts`, `src/domain/wait-group.ts`, `src/domain/events.ts`, `orquestrator.ts` (replay/recovery, `toMetadata`).
- **Testes (mock):** suspender por timeout → retomar volta a executar; replay reconstrói `SUSPENDED`; metadata expõe `waitingReason`.
- **DoD:** novo estado em todos os enumeradores de status (scheduler, recovery, metadata).

### F1.T3 — `failureReason` + cascade-cancel  ·  `pending`
- **O que:** Adicionar `failureReason: 'attempts' | 'stagnation' | 'ceiling' | 'blocked'` a `FAILED` (preenchido nas paradas de F3/F4). Tornar o **cancelamento em cascata** (cancelar pai cancela filhos) um invariante explícito e testado.
- **Toca:** `src/domain/task.ts`, `orquestrator.ts` (`failTask`, `cancelTask`).
- **Testes (mock):** falha por cada motivo grava `failureReason`; cancelar pai cancela árvore.
- **DoD:** motivo de falha auditável; cascade-cancel garantido.

### F1.T4 — Round-trip + caracterização de transições  ·  `pending`
- **O que:** Teste de round-trip `serialize`→`fromSerialized` para o novo shape (compat — Restrição 6). Suíte percorrendo cada transição via mocks (harness F0): pause/move em RUNNING, cancel em WAITING, reopen de REVIEW, crash-recovery de cada estado não-terminal incl. `SUSPENDED`.
- **Toca:** `src/__tests__/domain/state-machine.test.ts` (novo), complementos em `orquestrator.test.ts`.
- **Testes:** este é o teste; rede de segurança para F2–F6.
- **DoD:** toda transição do §4 coberta; round-trip e crash-recovery por estado verificados.

## Pontos de validação cobertos

- **Agent→Backend / Backend↔Filesystem:** transições por decisão de agente persistem evento + status corretos.
- **Recuperação:** replay reconstrói inclusive `SUSPENDED`; round-trip de shape garantido.
- **Backend→Front (contrato):** `waitingReason`, `SUSPENDED`, `failureReason` disponíveis no metadata (consumidos em F7).

## Critérios de saída (DoD da fase)

- [ ] F1.T1…F1.T4 em `done`.
- [ ] Máquina de estados é do domínio (tabela + guardas); transição ilegal lança.
- [ ] `SUSPENDED` presente e não-terminal; `WAITING` distingue subtask/humano; `failureReason` em `FAILED`.
- [ ] Round-trip de serialização e replay-equivalência do novo shape testados.
- [ ] `npm test` verde (e2e de F0 sem regressão); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
</content>
