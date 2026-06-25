---
fase: F8
slug: 08-e2e-coverage-and-validation
status: done
depends_on: [F0, F1, F2, F3, F4, F5, F6, F7]
---

# F8 — Cobertura HTTP/WS, Auth, Cenário A Completo e Validação Viva (§12)

**Status da fase:** `done` (implementado 2026-06-24 — ver PLAN.md §7.5; validação viva D7 é operacional, gated por chave)
**Objetivo:** Fechar as lacunas de teste de borda (integração de rotas HTTP via `inject`, broadcast/subscribe do WS, contrato de erro central, **decisão de auth**), conduzir o **Cenário A do §12** ponta a ponta pelo Fastify+WS reais com agentes mock DeepSeek, e selar com **um run de validação viva** real em `provider=deepseek` / `deepseek-v4-flash` / `effort=high`.
**Depende de:** F0–F7.

## Por que esta fase

F0 trouxe o primeiro e2e e o harness; as fases seguintes adicionaram capacidades com seus próprios e2e. F8 garante **cobertura sistemática da borda** (toda rota HTTP + o WS), resolve a **auth** reivindicada mas ausente (commit 149aeab, L19) de forma consciente (implementar ou adiar com justificativa), e prova o **fluxo completo** do §12 Cenário A: `Manager → Architecture → Produto → Engineer → Code Reviewer → QA → Manager (consolidação/fechamento)`. Por fim, a **validação viva** confirma que toda a engrenagem roda contra o provider real exigido.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F8.T1 | Cobertura de integração de todas as rotas HTTP + WS (inject + cliente WS real) + fuzz de payload | `pending` |
| F8.T2 | Retry manual + validação zod de frame WS + decisão de auth + **ledger de decisões adiadas** | `pending` |
| F8.T3 | Cenário A completo (§12) e2e com agentes mock DeepSeek | `pending` |
| F8.T4 | Run de validação viva: deepseek / deepseek-v4-flash / effort=high | `pending` |
| F8.T5 | **Testes de caos/resiliência + falha composta** (kill mid-epoch, log corrompido, perda parcial de snapshot) | `pending` |
| F8.T6 | **Cenários B e C do §12 e2e** (bug urgente / documentação — rotas encurtadas) | `pending` |

### F8.T1 — Cobertura HTTP/WS sistemática  ·  `pending`
- **O que:** Testes de integração (Fastify `inject` + cliente WS real do harness F0) para **todas** as rotas: tasks (CRUD/move/cancel/retry, `messages` com anexo, `attachments` upload, `artifacts` list/download), agents, projects, settings, events (SSE), reports — incluindo o **contrato de erro central** (`error-handler.ts`) e CORS para `PATCH`/`DELETE` (cf. memória do projeto sobre `@fastify/cors` omitir métodos). Rotas de artefato cobrem 200 stream + Content-Type/Disposition, 404 desconhecido, 400/403 traversal. WS: broadcast + filtro de subscribe por `taskId` + **catch-up `sinceSeq`** (de F7.T5).
- **Toca:** `src/__tests__/infrastructure/api/*.test.ts` (novos), harness F0.
- **Fuzz de borda (Rev1 matriz):** incluir casos de **payload malicioso/oversized/Unicode edge** (ex.: corpo acima do limite zod, strings de controle, emojis/combining chars, caminhos de path-traversal) — a borda rejeita limpo (400/413), nunca derruba o processo.
- **Testes:** este é o teste; cada rota e o WS cobertos, incl. fuzz.
- **DoD:** toda rota HTTP e o WS com cobertura de integração + fuzz; contrato de erro e CORS PATCH/DELETE garantidos.

### F8.T2 — Retry manual, validação WS, auth e ledger de adiamentos  ·  `pending`
- **O que:** Endpoint de **retry manual** de task (se ausente); **validação zod** das mensagens recebidas no WS (subscribe/unsubscribe) na borda; **decisão de auth**: implementar o mínimo server-side reivindicado (149aeab) **ou** adiar explicitamente com justificativa `ponytail:` documentada. **Ledger de decisões adiadas (M10):** consolidar num único doc (`plan/DEFERRED.md` ou seção do PLAN.md) **toda** feature adiada conscientemente (auth, reset+handoff de F2.T7, compactação avançada, etc.), cada uma com `ponytail:` + **condição/data de reavaliação** — adiar é decisão rastreável, não lacuna acidental.
- **Toca:** `src/infrastructure/api/routes/tasks.ts`, `ws-server.ts`, middleware de auth (se implementar), `plan/DEFERRED.md`.
- **Testes (mock):** retry manual reexecuta; frame WS inválido é rejeitado; (se auth) request sem credencial é barrado.
- **DoD:** retry manual + validação de frame WS presentes; auth resolvida (implementada ou adiada por escrito); ledger de adiamentos preenchido.

### F8.T3 — Cenário A completo (§12)  ·  `pending`
- **O que:** E2e que dirige o **Cenário A** inteiro pela borda real (HTTP+WS) com agentes **mock determinísticos** representando o caminho DeepSeek: criar task de alta complexidade (com **anexo do humano**) → Manager decompõe → Architecture/Produto especificam → Engineer implementa **e gera um artefato** → Code Reviewer + QA aprovam (gate de F5, recebendo o artefato) → DoD satisfeita → Manager consolida → COMPLETED. Assertar: sequência de eventos no ledger (incl. `ARTIFACT_CREATED`), frames WS na ordem por `seq`, **o conteúdo do artefato é buscável via `GET /api/tasks/:id/artifacts/:fileName`** (e renderizável — teste de UI/contrato), fechamento de árvore e consolidação de memória.
- **Toca:** `src/__tests__/e2e/scenario-a.e2e.test.ts` (novo).
- **Testes:** este é o teste; é o e2e abrangente do plano.
- **DoD:** Cenário A passa offline, determinístico, ponta a ponta pelo servidor real.

### F8.T4 — Validação viva DeepSeek (Cenário A completo)  ·  `pending`
- **O que:** Executar o **Cenário A completo** (múltiplos agentes, DoD, avaliação independente) real, gated por `DEEPSEEK_API_KEY`/`SWARM_VALIDATION=1`, fora do CI default, com `provider=deepseek`/`deepseek-v4-flash`/`effort=high`. **Distinção explícita de F0.T7 (PF11):** **F0.T7 = smoke mínimo** (1 task trivial, ex. “criar um health-check endpoint”) que valida só **conectividade + parse de decisão** do provider; **F8.T4 = integração completa** (cenário multi-agente com gate e DoD). Critérios de aceite separados; nenhum trabalho duplicado.
- **Toca:** `src/__tests__/validation/scenario-a.live.test.ts` (novo, gated), doc de como rodar.
- **Testes:** com chave, roda o Cenário A e completa; sem chave, `it.skip`.
- **DoD:** Cenário A vivo completa com DeepSeek v4 flash / effort high; documentado; CI default offline/verde.

### F8.T5 — Caos/resiliência + falha composta  ·  `pending`
- **O que (PF12, §3.6 “seguro diante de instabilidades”; M11):** O e2e funcional não testa instabilidade. Injetar falhas e afirmar recuperação limpa: (a) **kill do worker/processo mid-epoch** → replay-fold (F2) + recovery reconstroem o estado correto e a task retoma do checkpoint (F3.T5) sem efeitos duplicados (F4.T5); (b) **log de evento corrompido/truncado** (última linha parcial) → carga tolera/repara, sem perder o estado consistente; (c) **perda parcial de snapshot** → fallback para replay do `EventStore`. **Falha composta (M11):** combinar estagnação + teto de budget + timeout humano simultâneos e afirmar parada limpa e observável de cada card.
- **Toca:** `src/__tests__/e2e/resilience.e2e.test.ts` (novo), script de kill (mata o processo e verifica o replay), fixtures de log corrompido.
- **Testes:** este é o teste.
- **DoD:** crash/corrupção/perda parcial recuperam sem corromper o ledger; falha composta para limpo. `ponytail:` script bash de kill + replay, sem framework de chaos.

### F8.T6 — Cenários B e C do §12 (rotas encurtadas)  ·  `pending`
- **O que (Rev2-F5, §12):** O Cenário A exercita a rota longa; faltam as rotas **proporcionais ao risco**: **Cenário B** (bug funcional urgente: Manager→Produto→Engineer→QA→Manager — sem Architecture/Code Reviewer pesado) e **Cenário C** (documentação/débito leve: Manager→Generic→Code Reviewer→Manager). E2e de cada, com agentes mock, afirmando que o Manager **escolhe a rota encurtada** (menos camadas de especificação/avaliação) e conclui.
- **Toca:** `src/__tests__/e2e/scenario-b.e2e.test.ts`, `scenario-c.e2e.test.ts` (novos).
- **Testes:** este é o teste; exercita o roteamento dinâmico do Manager (profundidade de processo proporcional ao risco).
- **DoD:** rotas B e C passam ponta a ponta; roteamento encurtado comprovado.

## Pontos de validação cobertos

- **Toda a borda HTTP/WS** com cobertura de integração + contrato de erro + fuzz.
- **Front↔Backend↔Agent↔Filesystem** exercitado de ponta a ponta nos Cenários A, B e C.
- **Resiliência/Recuperação:** caos (kill/corrupção/perda parcial) e falha composta.
- **Backend→Agent (provider real):** validação viva DeepSeek v4 flash effort high.

## Critérios de saída (DoD da fase)

- [ ] F8.T1…F8.T6 em `done`.
- [ ] Toda rota HTTP (incl. artefatos + anexos + catch-up WS) com cobertura de integração + fuzz; contrato de erro e CORS PATCH/DELETE garantidos.
- [ ] Retry manual + validação de frame WS; auth implementada ou adiada por decisão escrita; ledger de adiamentos preenchido.
- [ ] **Cenários A, B e C (§12) passam ponta a ponta** offline com agentes mock pelo servidor+WS+filesystem reais (A inclui anexo do humano + artefato do agente buscável/renderizado).
- [ ] **Caos/resiliência** (kill mid-epoch, log corrompido, perda parcial de snapshot) + falha composta recuperam limpo.
- [ ] **Run de validação viva** (Cenário A, deepseek / deepseek-v4-flash / effort=high) executa e completa; **F0.T7 (smoke) e F8.T4 (completo) com critérios distintos**.
- [ ] `npm test` (root+web) verde; `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff final; achados endereçados/justificados.
- [ ] `graphify update` após o fechamento.
