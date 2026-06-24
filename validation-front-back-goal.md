# Goal: validar a integração Front ↔ Back do Kanban Code Agent

Você está em modo **goal**. Objetivo: garantir que **toda** mutação de
task/subtask no backend seja refletida no frontend (e vice‑versa) de forma
**100% orientada a eventos**, e implementar/validar as mudanças de fluxo
descritas abaixo. Corrija com a menor alteração possível e revalide.

## Contexto real do sistema (estado atual)

- **Back**: Fastify + WebSocket (`ws://localhost:35000/ws`) com fallback SSE;
  event‑sourced; persistência em filesystem.
- **Front**: React + Vite + Zustand (`web/src/stores/kanbanStore.ts`) +
  shadcn/ui.
- **Fontes da verdade**: `.swarm/events/current.jsonl` (append‑only) e
  `.swarm/state.snapshot.json` (projeção reconstruível).
- **Endpoints**: `GET/POST /api/tasks`, `GET /api/tasks/:id`,
  `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id` (cancela),
  `GET /api/tasks/:id/chat`, `GET /api/events`, `GET /api/agents`.
- **Status existentes** (`src/domain/types.ts`): `PENDING, QUEUED, RUNNING,
  WAITING, COMPLETED, FAILED, CANCELLED`. **Não existe `REVIEW`.**
- **Colunas atuais** (`web/src/components/kanban/KanbanBoard.tsx`): Inbox,
  Manager, Produto/Generic, Architecture/Engineer, CodeReviewer/QA, Done.
  **Não existem colunas "Revisão" nem "Cancel"; não há "arquivar".**

## Premissas (obrigatórias)

1. **Sem polling. Apenas push (webhook/WebSocket).** Hoje o front faz
   `client.onEvent(() => fetchTasks())` — refetch total da lista a cada evento.
   Isso é um anti‑padrão (efeito polling). O front deve **aplicar o payload do
   evento incrementalmente** na store (projeção event‑sourced no cliente),
   refetch só no bootstrap/reconexão.
2. **Tudo orientado a eventos.** Nenhuma mutação visível no front pode depender
   de re‑busca periódica; toda mudança chega por evento WS/SSE.
3. **Subtask `COMPLETED` some do board do agent.** Não é mais exibida na coluna
   do agente; permanece acessível pelo **summary** e pelo **workflow** dentro
   da task pai.
4. **Fluxo de Revisão**: quando o Manager decide que a task está pronta, ele a
   joga para **Revisão** (não para Done). Concluir é responsabilidade do
   **usuário** (mover Revisão → Done).
5. **Reabertura por mensagem**: task em Revisão que recebe mensagem do usuário
   **volta para execução** e segue o fluxo padrão (sai de Revisão).
6. **Layout**: coluna **Revisão** fica **antes** de Done e ocupa a **altura
   inteira** de uma coluna (não meia‑coluna multi‑agente).
7. **Coluna Cancel** depois de Done. Usuário pode mover tasks para lá
   manualmente (equivale a cancelar).
8. **Arquivar**: nas colunas **Done** e **Cancel** há um botão no **header da
   coluna**; abre **modal de confirmação**; ao confirmar, as tasks daquela
   coluna são **arquivadas**.
9. **Arquivadas** vão para um diretório especial `_archived` e **somem do
   board** (não retornam em `GET /api/tasks` padrão).

## Mudanças requeridas (com critério de aceite)

### A. Status/coluna "Revisão"
- Introduzir o conceito de "em revisão" no domínio (novo status `REVIEW` ou
  flag equivalente) e propagá‑lo no event log, snapshot, API e adapter do front.
- Manager, ao concluir a task raiz, emite evento que coloca a task em
  **Revisão** (não em `COMPLETED`).
- **Aceite**: task aparece na coluna Revisão; evento correspondente no
  `current.jsonl`; snapshot consistente; front mostra sem refetch manual.

### B. Conclusão pelo usuário (Revisão → Done)
- Mover Revisão → Done marca a task como `COMPLETED` via `PATCH /api/tasks/:id`.
- **Aceite**: transição só ocorre por ação do usuário; gera evento; reflete no
  front via push.

### C. Reabertura (Revisão → execução por mensagem)
- Enviar mensagem para task em Revisão a tira de Revisão e a recoloca no fluxo
  (volta ao Manager/execução).
- **Aceite**: status muda de `REVIEW` para o estado de execução; evento de
  resume/queued registrado; coluna no front muda sem refetch manual.

### D. Coluna Cancel + mover manual
- Nova coluna após Done. Drop nela ⇒ `DELETE /api/tasks/:id` (ou PATCH para
  `CANCELLED`). `PATCH`/`moveTask` hoje só aceitam `inbox|manager`: ampliar as
  transições permitidas ao usuário (done/cancel/reabrir) no back e no front.
- **Aceite**: task vai para `CANCELLED`; worker ativo é parado; evento
  `TASK_CANCELLED`; sem execução fantasma.

### E. Arquivar (Done/Cancel)
- Botão no header das colunas Done e Cancel → modal de confirmação → arquiva as
  tasks da coluna movendo a persistência para `_archived` e emitindo evento de
  arquivamento.
- **Aceite**: arquivos da task vão para `_archived`; tasks somem do board e de
  `GET /api/tasks`; evento registrado; snapshot consistente; permanecem legíveis
  em `_archived` (auditoria).

### F. Subtask concluída some do board
- Subtask `COMPLETED` não renderiza na coluna do agente; continua no
  summary/workflow da task pai.
- **Aceite**: coluna do agente não lista subtasks concluídas; summary/workflow
  ainda as exibe.

## Matriz de validação Front ↔ Back

Para **cada** transição abaixo, validar os 4 lados ao mesmo tempo:
(1) evento em `.swarm/events/current.jsonl`; (2) `state.snapshot.json`;
(3) resposta da API; (4) board do front atualizado **por push**, sem refetch
total e sem ação manual.

| Ação | Origem | Resultado esperado |
|---|---|---|
| Criar task em Inbox | front/API | card em Inbox, sem execução, `TASK_CREATED` |
| Criar task no Manager (execute=true) | front/API | vai p/ Manager, enfileira/executa |
| Mover Inbox → Manager | front (drag) | re‑schedule, começa execução |
| Mover Manager → Inbox | front (drag) | pausa, worker parado, sem execução fantasma |
| Manager decompõe em subtasks | back | subtasks criadas/atribuídas aos agents corretos |
| Subtask inicia/conclui | back | aparece e depois **some** da coluna do agent |
| Manager conclui raiz | back | task vai p/ **Revisão** (não Done) |
| Revisão → Done | front (usuário) | `COMPLETED` |
| Revisão + mensagem do usuário | front | volta para execução |
| Mover qualquer → Cancel | front | `CANCELLED`, worker parado |
| Arquivar Done | front (modal) | tasks → `_archived`, somem do board |
| Arquivar Cancel | front (modal) | tasks → `_archived`, somem do board |
| Editar runtimeConfig (model/effort) | front | refletido na task e eventos |
| Enviar mensagem em task ativa | front | chat sem duplicar/perder, push imediato |
| Upload de anexo | front/API | anexo persistido e referenciado |
| Reconexão WS | front | re‑hidrata estado por snapshot, sem perder eventos |

## Como validar (orientado a eventos)

1. Suba o servidor e o front; abra o board e o `tail -f .swarm/events/current.jsonl`.
2. Execute cada linha da matriz e confirme os 4 lados.
3. **Prove a ausência de polling**: na aba Network não deve haver `GET
   /api/tasks` periódico; mudanças chegam por frames WS. Mutação aplicada na
   store deve vir do **payload do evento**, não de refetch.
4. Para cada falha: causa raiz → menor correção → revalida o cenário → roda
   regressão curta dos cenários anteriores.
5. Preserve a arquitetura: event log como fonte da verdade, filesystem como
   persistência, Domain/Application/Infrastructure/CLI, sem banco externo.
6. Use `graphify` para entender fluxo/dependências; após grandes alterações,
   `graphify update`.

## Eventos a observar

`TASK_CREATED, TASK_UPDATED, TASK_QUEUED, TASK_STARTED, TASK_WAITING,
TASK_RESUMED, TASK_COMPLETED, TASK_FAILED, TASK_CANCELLED` + novos eventos
necessários para **Revisão** e **Arquivamento** (nomeie seguindo a convenção
existente). Valide semântica e ordem, não só o nome.

## Relatório final (markdown)

- **Resumo**: status geral (PASSOU / PASSOU COM AJUSTES / FALHOU); push sem
  polling confirmado (sim/não); persistência/arquivamento testados (sim/não).
- **Tabela** com cada linha da matriz: `Cenário | Front | Back/Evento |
  Snapshot | Status | Evidência`.
- **Bugs**: descrição, causa raiz, arquivo(s), correção, cenário revalidado.
- **Arquivos alterados**.
- **Pendências**: o que não foi possível validar/corrigir.

## Critério final de sucesso

- Todas as transições da matriz refletem nos 4 lados.
- Front é **event‑driven puro** (push, sem refetch total por evento, sem polling).
- Revisão, Cancel, Arquivar e ocultação de subtask concluída funcionam.
- Manager joga para Revisão; usuário conclui; mensagem reabre.
- `_archived` recebe arquivadas e elas somem do board.
- Event log permanece fonte da verdade; restart/replay não perde estado.
