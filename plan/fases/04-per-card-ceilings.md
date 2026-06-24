---
fase: F4
slug: 04-per-card-ceilings
status: done
depends_on: [F0, F1]
---

# F4 — Tetos por-Card (Custo + Tempo), Budget Persistido e Condições de Parada (§10)

**Status da fase:** `pending`
**Objetivo:** Mover as travas de governança do §10 para o domínio: impor **tetos por-card** de **custo** e de **tempo de computação ativa acumulada** (não só global), **persistir e reidratar** o budget acumulado para que os tetos **sobrevivam a restart**, e abortar **apenas o card infrator** (sem derrubar os irmãos). Falhar de forma limpa e observável.
**Depende de:** F0, F1.

## Por que esta fase

`BudgetTracker` soma tokens/custo **em memória** e o teto é **global** via env (L9) — **reseta no restart** e não há teto por-card nem teto de **tempo ativo** (só `runTimeoutMs` por run). O §10.5 pede que cada card carregue seu próprio teto de custo e de tempo, e que ultrapassá-lo **suspenda imediatamente** aquele card. Como o custo de execução autônoma cresce a cada turno, este é um requisito de segurança real.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F4.T1 | Value object de governança + guardas de condição de parada no domínio | `pending` |
| F4.T2 | Tetos por-card (custo + tempo ativo) abortando só o infrator | `pending` |
| F4.T3 | Persistir + reidratar budget acumulado (sobrevive a restart) | `pending` |
| F4.T4 | Catálogo das 6 condições de parada (§10) observável + testes | `pending` |
| F4.T5 | **Idempotência de efeitos colaterais na retomada (§3.6)** | `pending` |
| F4.T6 | **Graceful degradation: aviso ao aproximar tetos (wrap-up limpo)** | `pending` |

### F4.T1 — Governança no domínio  ·  `pending`
- **O que:** Value object `Governance` (em `domain`) com `maxCost`, `maxActiveMs`, `maxDepth`, `maxRetries` e **`maxEpochsWithoutCompletion`** (usado em F3.T2) — defaults configuráveis (env/file) e override por task. Mover a **comparação de guarda** (counter ≥ ceiling) para perto do domínio, em vez de só no metadata derivado. **Imutabilidade mid-flight (M3, §1.5):** a task em execução usa o `Governance`/runtimeConfig **capturado no início do run** (snapshot no run), não a config global atual — mudar a config global não quebra a coerência de execuções em andamento. **Prioridade de budget (M9):** documentar que o **teto por-card é o gate primário** e o teto **global é a rede de segurança** (o global só dispara se o por-card falhar).
- **Toca:** `src/domain/task.ts` (ou `domain/governance.ts` novo), `src/domain/run.ts` (snapshot de config no run), `src/infrastructure/config.ts` (defaults).
- **Testes (mock):** guarda de profundidade vira invariante de domínio; tetos default vêm da config/env; **mudar a config global mid-run não altera o gate do run em andamento** (usa o snapshot).
- **DoD:** governança modelada no domínio com config imutável por run; prioridade por-card>global documentada; `ponytail:` value object simples, sem framework de regras.

### F4.T2 — Tetos por-card  ·  `pending`
- **O que:** Ao acumular métricas por task (`task.metrics.cost`/`durationMs`), checar **por card**: excedeu `maxCost` ou `maxActiveMs` ⇒ suspender imediatamente aquele card (→ `FAILED`/`SUSPENDED` com `failureReason='ceiling'`), emitir `BUDGET_EXCEEDED` com escopo do card. Irmãos seguem. Teto global permanece como rede.
- **Toca:** `src/application/budget-tracker.ts`, `orquestrator.ts` (`assertWithinBudget` por card).
- **Testes (mock):** card excede custo → para só ele; excede tempo ativo → idem; irmão continua.
- **DoD:** tetos por-card aplicados sem afetar a árvore; auditável.

### F4.T3 — Budget persistido/reidratado  ·  `pending`
- **O que:** Persistir o gasto acumulado (já vive em `task.metrics`, persistido) e **re-semear** o `BudgetTracker` a partir das métricas das tasks ao reidratar, de modo que o gate vivo bata exatamente com o estado restaurado — um card não pode furar o teto pós-restart.
- **Toca:** `src/application/budget-tracker.ts`, `orquestrator.ts` (`loadState`/re-seed).
- **Testes (mock):** gastar até perto do teto → reiniciar → próximo passo respeita o teto (não “zera” o gasto).
- **DoD:** budget sobrevive a restart; gate pós-restart == gate vivo (teste dedicado).

### F4.T4 — Catálogo de condições de parada  ·  `pending`
- **O que:** Tornar explícitas e observáveis as 6 condições do §10: (1) concluída; (2) exaustão de tentativas; (3) estagnação (F3); (4) profundidade; (5) tetos custo/tempo por-card (F4.T2); (6) timeout humano (estado de F1, fluxo em F6). Cada parada emite evento padronizado com `failureReason`.
- **Toca:** `orquestrator.ts`, `src/domain/events.ts`.
- **Testes (mock):** cada condição produz evento/estado terminal esperado; 1 e2e: card que fura teto reportado via WS.
- **DoD:** todas as condições cobertas por evento/estado e teste.

### F4.T5 — Idempotência de efeitos colaterais na retomada  ·  `pending`
- **O que:** §3.6 exige que “uma retomada após falha não duplique o efeito”. Hoje só há **um** guard: dedup em-memória de `create_subtask` por `(assignedTo,title,message)` (`orquestrator.ts:1022-1029`) — **funciona** (inclui o corpo da mensagem), mas casar por conteúdo **não é determinístico o bastante** para o contrato de replay (PF5). Trocar por **chave de idempotência explícita por tool-call** (id gerado pelo harness no momento da invocação, **armazenado no run**), e aplicá-la a `create_subtask`, `create_artifact` (`:1048`) e `post_message` (`:991`) — re-rodar a epoch após crash reusa a chave e **não duplica**. Estender o dedup de `recordEvent` (`:1898-1912`, hoje só eventos terminais) para os não-terminais re-emitidos no re-run.
- **Toca:** `src/application/orquestrator.ts` (`execute` das tools + `recordEvent`), `src/domain/run.ts` (registro de chaves usadas).
- **Testes (mock):** força crash-após-side-effect + re-run da mesma epoch → contagem estável de artefatos/mensagens/eventos (zero duplicatas), inclusive com subtasks de mesmo título e **corpos diferentes** (não colidem) e mesmo corpo (idempotente pela chave).
- **DoD:** retomada idempotente por chave explícita; nenhum efeito colateral duplicado. `ponytail:` chave = id no run, sem framework de idempotência.

### F4.T6 — Graceful degradation ao aproximar tetos  ·  `pending`
- **O que (M1, §10.5 “falhar de forma limpa”):** Morte súbita por teto deixa artefatos pela metade. Avisar o agente quando atinge um **threshold** (ex.: 80%) do teto de custo/tempo do card, via uma mensagem de sistema (ou tool `budget_warning` consultável), dando chance de **wrap-up limpo** (gravar progresso/artefatos parciais, deixar handoff) antes do `FAILED(ceiling)` abrupto.
- **Toca:** `orquestrator.ts` (checagem de threshold no acúmulo de métricas), `prompt-builder.ts`/tools.
- **Testes (mock):** ao cruzar 80% do teto, o agente recebe o aviso antes do corte; um wrap-up registra progresso antes do `FAILED(ceiling)`.
- **DoD:** aviso de aproximação de teto entregue; corte por teto não deixa estado órfão. `ponytail:` um aviso no prompt no cruzamento do threshold, sem subsistema.

## Pontos de validação cobertos

- **Backend↔Filesystem / Recuperação:** budget persistido bate com o gate após reidratar.
- **Agent→Backend:** acúmulo de custo/tempo por card barrado no limite certo.
- **Backend→Front:** motivo de parada/teto chega à UI (F7).

## Critérios de saída (DoD da fase)

- [ ] F4.T1…F4.T6 em `done`.
- [ ] Tetos por-card de custo **e** tempo ativo; profundidade como invariante; config imutável por run; `maxEpochsWithoutCompletion` no Governance.
- [ ] Aviso de aproximação de teto (graceful wrap-up) antes do corte abrupto.
- [ ] Budget persiste e reidrata; estado sobre-teto sobrevive a restart; aborta só o infrator.
- [ ] As 6 condições do §10 explícitas, observáveis e testadas.
- [ ] Tools com efeito colateral idempotentes na retomada (sem duplicar artefatos/mensagens/eventos).
- [ ] `npm test` verde (mock + e2e); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
</content>
