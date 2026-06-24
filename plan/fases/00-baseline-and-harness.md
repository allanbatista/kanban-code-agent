---
fase: F0
slug: 00-baseline-and-harness
status: done
depends_on: []
---

# F0 — Baseline, Harness de Testes e Primeiro E2E Real

**Status da fase:** `pending`
**Objetivo:** Transformar a base atual numa fundação confiável e reproduzível: fixar o verde (285 testes), **versionar `PROJECT.md` + `web/`**, unificar o registro de modelos (L13) e o data-root (L18), **ligar o `ProjectFileStore`** (L14), extrair **um harness de mock de LLM + servidor reutilizável**, subir o **primeiro e2e de verdade** (`front → backend → agent → filesystem → WS`) e **plugar a validação viva DeepSeek v4 flash effort=high** (L17). Tudo que vem depois se apoia nisto.
**Depende de:** —

## Por que esta fase

O sistema já é forte, mas: (a) `PROJECT.md` e `web/` estão untracked (L16); (b) o seam de mock vive só dentro de `orquestrator.test.ts` e não é reutilizável; (c) **nenhum teste exercita a borda real HTTP/WS** (L15) — features marcadas “done” já estiveram quebradas; (d) registro de modelos diverge (openrouter vs deepseek, L13); (e) `ProjectFileStore` está órfão (L14). Sem fixar isto, as próximas fases constroem sobre chão não verificado.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F0.T1 | Versionar `PROJECT.md` + `web/`; `.gitignore` correto | `pending` |
| F0.T2 | Unificar registro de modelos (orquestrator ⇄ config) — DeepSeek coerente (L13) | `pending` |
| F0.T3 | Esclarecer/unificar e documentar o data-root (`~/.kca`/`.swarm`) (L18) | `pending` |
| F0.T4 | Ligar `ProjectFileStore` em `routes/projects.ts` (fecha US-6) (L14) | `pending` |
| F0.T5 | Extrair harness de mock de agente + `buildOrquestrator`/`buildServer` | `pending` |
| F0.T6 | Primeiro e2e: HTTP → Manager mock → subtask → complete; asserts WS + ledger + arquivos | `pending` |
| F0.T7 | Plug de validação viva DeepSeek v4 flash effort=high (opt-in, gated) (L17) | `pending` |

### F0.T1 — Versionar `PROJECT.md` + `web/`  ·  `pending`
- **O que:** `git add PROJECT.md` e `web/` (com `.gitignore` cobrindo `node_modules/`, `dist/`, `.pi/`). Conferir scripts root (`build:web`, `dev:all`).
- **Toca:** `PROJECT.md`, `web/**`, `.gitignore`, raiz `package.json`.
- **Testes:** `cd web && npm test` verde; `npm run build:web` compila.
- **DoD:** `git status` limpo após add; build do front passa.

### F0.T2 — Unificar registro de modelos (L13)  ·  `pending`
- **O que:** `orquestrator.ts` hardcoda `ALLOWED_MODELS` com `openrouter`, enquanto `config.ts` resolve `deepseek`. O metadata anuncia openrouter mas o runner usa config — incoerente. Injetar o registro resolvido de `loadConfig().models` no `Orquestrator` via `OrquestratorDeps`. Default permanece DeepSeek.
- **Toca:** `src/application/orquestrator.ts`, `src/cli/orquestrator-factory.ts`, `src/infrastructure/config.ts`.
- **Testes (mock):** `toMetadata().allowedModels` reflete a config injetada (DeepSeek por default; override por env/file respeitado).
- **DoD:** fonte única de provider/model; nenhum `openrouter` como default. `ponytail:` passar `models` como campo simples em `OrquestratorDeps`, sem fábrica.

### F0.T3 — Data-root coerente e documentado (L18)  ·  `pending`
- **O que:** Hoje `dataDir=~/.kca` (config) e os stores usam subdir `.swarm` (logo `~/.kca/.swarm/...`). Não é bug, mas dois nomes confundem. Decidir e **documentar** a convenção (manter `~/.kca` como raiz, `.swarm` como subdir do swarm) e garantir que testes e runtime concordem; expor `SWARM_DATA_DIR` na doc.
- **Toca:** `src/infrastructure/config.ts` (comentário/doc), `docs/` curto, persistence (sem mudança funcional se já coerente).
- **Testes:** teste afirma o caminho efetivo do log/snapshot dado `SWARM_DATA_DIR`.
- **DoD:** convenção documentada; nenhum teste/dev surpreso com o caminho.

### F0.T4 — Ligar `ProjectFileStore` (L14)  ·  `pending`
- **O que:** `ProjectFileStore` existe e é testado, mas `routes/projects.ts` não o usa — projetos não persistem (US-6 falsa). Ligar as rotas CRUD ao store (database-as-filesystem).
- **Toca:** `src/infrastructure/api/routes/projects.ts`, fiação no `http-server`/factory.
- **Testes (mock + e2e):** criar projeto via HTTP → reiniciar store → projeto persiste; CRUD coberto.
- **DoD:** projetos sobrevivem a restart; rota usa o store real.

### F0.T5 — Harness de mock + servidor reutilizável  ·  `pending`
- **O que:** Promover o seam de `orquestrator.test.ts` (`makeRunner`/`makeDecisionRunner`/`makeRoutedRunner`, `completedDecision`/`waitingDecision`/`retryDecision`) para `src/__tests__/_helpers/mock-agent.ts`; criar `buildOrquestrator(deps?)` (stores em `tmpdir`, runner injetável) e `buildServer(deps?)` que monta a app Fastify real (HTTP+WS) **sem** `listen` fixo, para e2e. Pode exigir extrair `buildServer(deps)` do `server.ts`/`http-server.ts`.
- **Toca:** `src/__tests__/_helpers/{mock-agent,orquestrator-fixture,e2e-server}.ts` (novos); refactor leve em `server.ts`/`http-server.ts`; `orquestrator.test.ts` importa do helper.
- **Testes:** os 285 testes continuam verdes (caracterização); smoke do `buildServer` (sobe/derruba sem vazar handle).
- **DoD:** zero duplicação de runner; harness reusado pelas próximas fases.

### F0.T6 — Primeiro e2e front→backend→agent→filesystem→WS  ·  `pending`
- **O que:** O teste-âncora. Via HTTP real: `POST /api/tasks` (execute=true) → Manager mock cria 1 subtask → subtask mock conclui → Manager consolida → root vai a REVIEW. Assertar **na borda**: (1) frames WS com **`seq` estritamente crescente e igual à sequência do ledger** (ordem checada por `seq`, não por ordem de chegada — trava o contrato que o catch-up de F7.T5 depende); (2) `.swarm/events/current.jsonl` com a sequência esperada; (3) snapshot reconstruível; (4) arquivos da task (`chat.jsonl`, `tasks/<id>/...`) atômicos; (5) `GET /api/tasks/:id` reflete REVIEW. Quando F6.T4/F7.T6 existirem, estender (ou e2e irmão) para cobrir **anexo do humano na criação** (arquivo em `attachments/`, `MESSAGE_APPENDED` com anexo) e **artefato do agente** buscável via `GET /api/tasks/:id/artifacts/:fileName`.
- **Toca:** `src/__tests__/e2e/task-lifecycle.e2e.test.ts` (novo), usa F0.T5.
- **Testes:** este é o teste; cobre os pontos de validação da fronteira, com ordem por `seq`.
- **DoD:** e2e verde e **determinístico** (sem rede; agente 100% mock); ordem por `seq` mecanicamente verificada.

### F0.T7 — Plug de validação viva DeepSeek v4 flash effort=high (L17)  ·  `pending`
- **O que:** Caminho explícito para um fluxo real contra DeepSeek com `deepseek-v4-flash` e `effort=high`. Como `effort` não vive em `SwarmConfig` (e sim em `runtimeConfig`), criar **perfil de validação**: env `SWARM_VALIDATION_EFFORT=high` (default high) + agentes de validação `{model:'fast', effort:'high'}` (resolve a `deepseek-v4-flash`). Script `npm run validate:live` / teste `*.live.test.ts` **skippado** sem `DEEPSEEK_API_KEY`/`SWARM_VALIDATION=1`. **Escopo desta task = SMOKE mínimo (PF11):** **1 task trivial** (ex.: “criar um health-check endpoint”) que valida só **conectividade do provider + parse da decisão** — o Cenário A completo multi-agente é **F8.T4** (critérios de aceite distintos; nada duplicado).
- **Toca:** `src/__tests__/validation/live-deepseek.live.test.ts` (novo, gated), `package.json` (script), doc curta.
- **Testes:** com chave, roda 1 task trivial real e afirma `provider=deepseek`/`modelId=deepseek-v4-flash`/`effort=high`; sem chave, `it.skip`.
- **DoD:** comando documentado; CI sem chave continua verde (skip limpo).

## Pontos de validação cobertos

- **Front→Backend / Backend→Front:** F0.T6 (HTTP create + WS stream).
- **Agent→Backend / Backend↔Filesystem / Recuperação:** F0.T6 (ledger + snapshot + arquivos).
- **Persistência de projetos:** F0.T4.
- **Backend→Agent (provider real):** F0.T7 (DeepSeek v4 flash effort high).

## Critérios de saída (DoD da fase)

- [ ] F0.T1…F0.T7 em `done`.
- [ ] `PROJECT.md` + `web/` versionados; `cd web && npm test`/`build` verdes.
- [ ] Registro de modelos unificado (sem `openrouter` default); data-root documentado.
- [ ] Projetos persistem (US-6); `ProjectFileStore` ligado.
- [ ] Harness compartilhado existe e é reusado; **e2e real (F0.T6) verde**.
- [ ] `npm run validate:live` documentado e skippa sem chave; com chave confirma DeepSeek v4 flash / effort high.
- [ ] `npm test` (root+web) verde; `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
</content>
