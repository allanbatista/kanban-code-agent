---
fase: F8
slug: 08-e2e-coverage-and-validation
status: pending
depends_on: [F0, F1, F2, F3, F4, F5, F6, F7]
---

# F8 — Cobertura HTTP/WS, Auth, Cenário A Completo e Validação Viva (§12)

**Status da fase:** `pending`
**Objetivo:** Fechar as lacunas de teste de borda (integração de rotas HTTP via `inject`, broadcast/subscribe do WS, contrato de erro central, **decisão de auth**), conduzir o **Cenário A do §12** ponta a ponta pelo Fastify+WS reais com agentes mock DeepSeek, e selar com **um run de validação viva** real em `provider=deepseek` / `deepseek-v4-flash` / `effort=high`.
**Depende de:** F0–F7.

## Por que esta fase

F0 trouxe o primeiro e2e e o harness; as fases seguintes adicionaram capacidades com seus próprios e2e. F8 garante **cobertura sistemática da borda** (toda rota HTTP + o WS), resolve a **auth** reivindicada mas ausente (commit 149aeab, L19) de forma consciente (implementar ou adiar com justificativa), e prova o **fluxo completo** do §12 Cenário A: `Manager → Architecture → Produto → Engineer → Code Reviewer → QA → Manager (consolidação/fechamento)`. Por fim, a **validação viva** confirma que toda a engrenagem roda contra o provider real exigido.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F8.T1 | Cobertura de integração de todas as rotas HTTP + WS (inject + cliente WS real) | `pending` |
| F8.T2 | Retry manual + validação zod de frame WS + decisão de auth | `pending` |
| F8.T3 | Cenário A completo (§12) e2e com agentes mock DeepSeek | `pending` |
| F8.T4 | Run de validação viva: deepseek / deepseek-v4-flash / effort=high | `pending` |

### F8.T1 — Cobertura HTTP/WS sistemática  ·  `pending`
- **O que:** Testes de integração (Fastify `inject` + cliente WS real do harness F0) para **todas** as rotas: tasks (CRUD/move/cancel/retry, `messages` com anexo, `attachments` upload, `artifacts` list/download), agents, projects, settings, events (SSE), reports — incluindo o **contrato de erro central** (`error-handler.ts`) e CORS para `PATCH`/`DELETE` (cf. memória do projeto sobre `@fastify/cors` omitir métodos). Rotas de artefato cobrem 200 stream + Content-Type/Disposition, 404 desconhecido, 400/403 traversal. WS: broadcast + filtro de subscribe por `taskId` + **catch-up `sinceSeq`** (de F7.T5).
- **Toca:** `src/__tests__/infrastructure/api/*.test.ts` (novos), harness F0.
- **Testes:** este é o teste; cada rota e o WS cobertos.
- **DoD:** toda rota HTTP e o WS com cobertura de integração; contrato de erro e CORS PATCH/DELETE garantidos.

### F8.T2 — Retry manual, validação WS e auth  ·  `pending`
- **O que:** Endpoint de **retry manual** de task (se ausente); **validação zod** das mensagens recebidas no WS (subscribe/unsubscribe) na borda; e **decisão de auth**: implementar o mínimo server-side reivindicado (149aeab) **ou** adiar explicitamente com justificativa `ponytail:` documentada (chamada consciente, não lacuna acidental).
- **Toca:** `src/infrastructure/api/routes/tasks.ts`, `ws-server.ts`, middleware de auth (se implementar).
- **Testes (mock):** retry manual reexecuta; frame WS inválido é rejeitado; (se auth) request sem credencial é barrado.
- **DoD:** retry manual + validação de frame WS presentes; auth resolvida (implementada ou adiada por escrito).

### F8.T3 — Cenário A completo (§12)  ·  `pending`
- **O que:** E2e que dirige o **Cenário A** inteiro pela borda real (HTTP+WS) com agentes **mock determinísticos** representando o caminho DeepSeek: criar task de alta complexidade (com **anexo do humano**) → Manager decompõe → Architecture/Produto especificam → Engineer implementa **e gera um artefato** → Code Reviewer + QA aprovam (gate de F5, recebendo o artefato) → DoD satisfeita → Manager consolida → COMPLETED. Assertar: sequência de eventos no ledger (incl. `ARTIFACT_CREATED`), frames WS na ordem por `seq`, **o conteúdo do artefato é buscável via `GET /api/tasks/:id/artifacts/:fileName`** (e renderizável — teste de UI/contrato), fechamento de árvore e consolidação de memória.
- **Toca:** `src/__tests__/e2e/scenario-a.e2e.test.ts` (novo).
- **Testes:** este é o teste; é o e2e abrangente do plano.
- **DoD:** Cenário A passa offline, determinístico, ponta a ponta pelo servidor real.

### F8.T4 — Validação viva DeepSeek  ·  `pending`
- **O que:** Executar **um** run real (gated por `DEEPSEEK_API_KEY`/`SWARM_VALIDATION=1`, fora do CI default) usando o perfil de validação de F0.T7: `provider=deepseek`, `modelId=deepseek-v4-flash`, `effort=high`. Confirmar que uma task simples completa de ponta a ponta contra o provider real e que as métricas/eventos são coerentes.
- **Toca:** `src/__tests__/validation/scenario-a.live.test.ts` (novo, gated), doc de como rodar.
- **Testes:** com chave, roda e completa; sem chave, `it.skip`.
- **DoD:** run vivo executa e completa com DeepSeek v4 flash / effort high; documentado; CI default permanece offline/verde.

## Pontos de validação cobertos

- **Toda a borda HTTP/WS** com cobertura de integração + contrato de erro.
- **Front↔Backend↔Agent↔Filesystem** exercitado de ponta a ponta no Cenário A.
- **Backend→Agent (provider real):** validação viva DeepSeek v4 flash effort high.

## Critérios de saída (DoD da fase)

- [ ] F8.T1…F8.T4 em `done`.
- [ ] Toda rota HTTP (incl. artefatos + anexos + catch-up WS) com cobertura de integração; contrato de erro e CORS PATCH/DELETE garantidos.
- [ ] Retry manual + validação de frame WS; auth implementada ou adiada por decisão escrita.
- [ ] **Cenário A (§12) passa ponta a ponta** offline com agentes mock DeepSeek pelo servidor+WS+filesystem reais, incluindo anexo do humano + artefato do agente buscável/renderizado.
- [ ] **Run de validação viva** (deepseek / deepseek-v4-flash / effort=high) executa e completa.
- [ ] `npm test` (root+web) verde; `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff final; achados endereçados/justificados.
- [ ] `graphify update` após o fechamento.
</content>
