---
fase: F5
slug: 05-independent-evaluation-and-dod
status: done
depends_on: [F0, F1, F2]
---

# F5 — Avaliação Independente (QA + Code Reviewer), Guardrails de Papel e Definition of Done (§8.2, §11)

**Status da fase:** `done` (implementado 2026-06-24 — ver PLAN.md §7.5 e DEFERRED.md para cortes conscientes)
**Objetivo:** Implementar o pilar do §8.2/§11: antes de um root do Manager chegar a `REVIEW`/`COMPLETED`, **disparar automaticamente** passes de avaliação **segregados** de QA (comportamental) e Code Reviewer (estático), separados do gerador, que **ambos** precisam **aprovar**; reprovação devolve feedback acionável ao gerador. Unificar as definições de agente numa **fonte única com guardrails** (must/must-not + tool allow-list) e **impor a DoD** (§11).
**Depende de:** F0, F1, F2.

## Por que esta fase

QA e Code Reviewer **existem** em `agents/index.ts` mas **nunca são invocados** como crivo — a conclusão é **auto-declarada** (L4): root do Manager vai direto a `REVIEW` humano. Pior, as definições de agente estão **duplicadas** em `orquestrator-factory.ts` e `agents/index.ts` (L12), sem guardrails codificados. E a DoD do §11 (dupla aprovação, sem regressão, fechamento de árvore, consolidação de memória, sanidade orçamentária) não é imposta (L5).

> **Suposição que expira (§1.2):** a camada de avaliação é cara e depende do modelo. Implementar **configurável/desligável** por política e marcar com `ponytail:` como andaime reavaliável.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F5.T1 | Unificar definições de agente numa fonte com guardrails (must/must-not, tools) | `pending` |
| F5.T2 | Gate de dupla aprovação (QA + Code Reviewer) antes de REVIEW/COMPLETED | `pending` |
| F5.T3 | Critérios graduáveis + veredito (approve/reject + feedback) + loop de correção | `pending` |
| F5.T4 | Imposição da DoD (§11): regressão + fechamento de árvore + memória + budget | `pending` |
| F5.T5 | Testes mock (approve/reject/iterate) + e2e do gate | `pending` |

### F5.T1 — Fonte única de agentes com guardrails  ·  `pending`
- **O que:** Eliminar a duplicação (L12): uma única definição (`agents/index.ts`) consumida em runtime, com `mustNot`/tool allow-list por papel (§8.3): Manager não escreve código; Produto não decide arquitetura; QA não corrige código; Code Reviewer não reescreve; Generic não cria subtasks autônomas. `orquestrator-factory.ts` passa a importar daí. **Heurística de roteamento (M6, §8.3/§12):** documentar no prompt do Manager quando rotear para **Generic** (apoio de baixa complexidade: formatação de docs, i18n, limpeza de logs, ajustes tipográficos) vs **Engineer** (código/lógica), para não sobre-alocar Engineer em tarefas triviais.
- **Toca:** `src/infrastructure/agents/index.ts`, `src/cli/orquestrator-factory.ts`, prompt do Manager.
- **Testes (mock):** cada papel expõe tools/guardrails corretos; factory usa a fonte única; tarefa trivial roteia para Generic.
- **DoD:** zero duplicação; guardrails + heurística de roteamento codificados e testados.

### F5.T2 — Gate de dupla aprovação  ·  `pending`
- **O que:** Ao final do trabalho de execução, o Manager cria subtasks de **Code Reviewer** e **QA** sobre o artefato, em escopo **segregado** (não o mesmo agente/subárvore que produziu). Reusa subtask + wait group (event-driven, sem deadlock — já existe). Ambos precisam aprovar para seguir. Rota conforme §12 (A: Engineer→Code Reviewer→QA; B/C com menos camadas). **Os avaliadores recebem os `TaskArtifact` produzidos (caminho + conteúdo) como entrada explícita de review** — o crivo inspeciona o deliverável real, não só o scope-spec.
- **Toca:** `orquestrator.ts` (gating antes de REVIEW/COMPLETED), prompts dos avaliadores.
- **Testes (mock):** Manager delega QA+CR; ambos aprovam → segue; eventos `SUBTASK_CREATED` para ambos.
- **DoD:** avaliação independente é etapa real, separada do gerador.
- **Nota anti-one-shotting (Rev2-F1, §2.2):** o sistema **já** desencoraja resolver tudo numa epoch — só o Manager tem a tool de delegação (`includeDelegation`), executores são folhas, e `coerceToWait` coage `completed` prematuro a `WAITING`. Reforço **leve**: se o scope-spec (F2) tem >1 item não-atendido e o agente tentou fechar sem decompor/avançar item a item, injetar uma instrução de decomposição incremental. `ponytail:` nudge no prompt + reusar `coerceToWait`, sem detector novo.

### F5.T3 — Veredito graduável + loop de correção + protocolo de conflito  ·  `pending`
- **O que:** Estender o contrato de decisão para o avaliador retornar `verdict: 'approved'|'rejected'` + `criteria:[{name,passed,note}]` + `feedback`. Critérios subjetivos viram graduáveis (§8.2) com limiar duro: qualquer critério reprovado ⇒ falha. Reprovação reabre a execução com o feedback injetado (mecânica de reopen existente), incrementando epoch. **Contrato de re-revisão (PF6):** rejeição de **qualquer** avaliador → reabre execução com feedback; ao corrigir, **ambos** re-executam, mas com **escopo no diff** (não full scan), exceto se o diff afetar **contratos públicos** (aí full). `ponytail:` o estado `REVIEW` com reabertura já cobre o fluxo; basta **documentar** o contrato de escopo — sem novo estado `REVIEW_FAILED`. **Anti-deadlock de avaliação (Rev2-F8):** o ciclo “QA reprova → Engineer corrige → quebra o que o Code Reviewer aprovara → CR reprova…” é **quebrado pelo monitor de convergência (F3.T2)** — rejeições cruzadas que não convergem disparam `FAILED(stagnation)`/`max_epochs`, com alerta ao supervisor. Integra com F3.
- **Toca:** `src/application/decision-parser.ts`, `src/domain/task.ts` (tipos), `orquestrator.ts`, prompts (avaliador **cético**).
- **Testes (mock):** parse approved/rejected; critério reprovado força rejection; reject→feedback→2ª tentativa aprova; **rejeições cruzadas que não convergem terminam em FAILED via F3** (não loop infinito).
- **DoD:** veredito estruturado e validado por schema; contrato de re-revisão documentado; deadlock de avaliação tem saída (convergência). Feedback acionável e auditável.

### F5.T4 — Imposição da DoD (§11)  ·  `pending`
- **O que:** Antes de `COMPLETED`, checar cumulativamente: (1) objetivo atendido (scope-spec de F2 todo atendido + dupla aprovação); (2) **sem regressão** — gate de suíte estável; (3) **fechamento de árvore** — nenhuma subtask aberta (formalizar a guarda, base via `coerceToWait`); (4) **consolidação de memória** *(operacionalizada, PF7)* — o agente atualiza o **progress-log** (de F2.T2) com uma **entrada de fechamento** (resumo final de lições/mudanças) e limpa artefatos temporários; a DoD verifica que o progress-log tem a entrada de fechamento; o resumo também vai à memória durável do projeto; (5) **sanidade orçamentária** — dentro dos tetos (F4); (6) **integridade de artefatos** — todo artefato declarado no resultado **existe em disco** (checado via `task-file-store`, **sem** dependência do endpoint HTTP de F7) antes de concluir. Falha em qualquer um ⇒ não conclui.
- **Toca:** `orquestrator.ts` (guarda de DoD na transição), `task-file-store.ts` (checagem de existência), persistence (memória do projeto — `.swarm/memory/*` ou `project-file-store`).
- **Testes (mock):** árvore com subtask aberta não conclui; sem dupla aprovação não conclui; **artefato declarado com arquivo ausente em disco bloqueia conclusão**; conclusão grava entrada de fechamento no progress-log + memória.
- **DoD:** transição a COMPLETED só com todos os critérios; cada um auditável.

### F5.T5 — Testes mock + e2e  ·  `pending`
- **O que:** Cobrir approve, reject→iterate→approve, e DoD bloqueando conclusão prematura. 1 **e2e** pela borda real: criar task → Engineer mock entrega → CR+QA mock aprovam → DoD satisfeita → REVIEW/COMPLETED; assert de eventos no ledger e frames WS.
- **Toca:** `src/__tests__/application/independent-evaluation.test.ts` (novo), `src/__tests__/e2e/evaluation.e2e.test.ts` (novo).
- **Testes:** este é o teste.
- **DoD:** caminhos felizes/infelizes cobertos por mock; 1 e2e real verde.

## Pontos de validação cobertos

- **Separação executor/avaliador (§8.2)** provada (agentes distintos, escopos segregados).
- **Agent→Backend:** veredito estruturado parseado e validado.
- **Backend↔Filesystem:** consolidação de memória persistida e auditável.
- **E2e:** gate observável via WS + ledger.

## Critérios de saída (DoD da fase)

- [ ] F5.T1…F5.T5 em `done`.
- [ ] Definições de agente unificadas com guardrails; factory usa a fonte única.
- [ ] QA + Code Reviewer são gate real antes de concluir; gerador separado dos avaliadores; reprovação faz loop de feedback.
- [ ] DoD do §11 imposta e testada (dupla aprovação, fechamento de árvore, sem regressão, memória, budget).
- [ ] Avaliação **configurável/desligável** (marcada `ponytail:`).
- [ ] `npm test` verde (mock + e2e); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
