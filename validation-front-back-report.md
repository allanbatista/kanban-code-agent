# Relatório de Validação Front ↔ Back — Kanban Code Agent

## Resumo

- **Status geral**: **PASSOU COM AJUSTES** — todas as mudanças requeridas (A–F)
  foram implementadas; foi encontrado e corrigido um bug crítico que tornava o
  push WebSocket totalmente inoperante.
- **Push sem polling confirmado**: **sim**. O front deixou de fazer
  `fetchTasks()` a cada evento; agora aplica o payload do evento
  incrementalmente na store (upsert/remoção). `fetchTasks` só roda no
  bootstrap e o `state` (snapshot) só na (re)conexão.
- **Persistência / arquivamento testados**: **sim**. Tasks arquivadas vão para
  `.swarm/tasks/_archived/<id>`, somem do board e de `GET /api/tasks`, com
  evento `TASK_ARCHIVED` no log e snapshot consistente.

## Bug crítico encontrado e corrigido

**Push WebSocket nunca funcionou (handshake silenciosamente ignorado).**

- **Sintoma**: ao conectar em `ws://localhost:35000/ws` o servidor logava
  `WebSocket socket missing send method` e fechava a conexão; nenhum evento
  chegava ao front (o "event-driven" dependia, na prática, do refetch total).
- **Causa raiz**: em `src/infrastructure/api/http-server.ts`,
  `fastify.register(websocket)` é carregado de forma diferida, mas a rota `/ws`
  era registrada **sincronamente** logo em seguida. O hook `onRoute` do
  `@fastify/websocket` (que marca a rota como websocket) ainda não estava
  instalado, então `/ws` era tratada como GET HTTP normal e o handler recebia
  `(request, reply)` em vez do `WebSocket` — daí `socket.send` inexistente.
- **Correção**: registrar o plugin e a rota juntos num escopo encapsulado e
  aguardado:
  ```ts
  fastify.register(async (instance) => {
    await instance.register(websocket);
    registerWebSocket(instance, orquestrator);
  });
  ```
- **Revalidação (cliente WS real contra o servidor)**:
  `OPEN → state(len=0) → TASK_CREATED hasTask=true st=PENDING →
  TASK_CANCELLED hasTask=true st=CANCELLED`; arquivamento:
  `TASK_ARCHIVED task=task_1 hasTask=false payload.archivedTaskIds=[task_1]`.

**Outro ajuste**: geração assíncrona de título passou a abortar se a task foi
arquivada/removida no meio do caminho, evitando `TASK_UPDATED` órfão no log.

## Mudanças implementadas (A–F)

- **A. Revisão**: novo status `REVIEW` + evento `TASK_REVIEW`. Ao concluir, uma
  task **raiz do Manager** vai para `REVIEW` (subtasks e raízes não-Manager
  continuam `COMPLETED`, preservando wait groups). Coluna **Revisão** (altura
  inteira) antes de Done.
- **B. Conclusão pelo usuário**: `PATCH /api/tasks/:id {status:COMPLETED}` →
  `completeTaskByUser` (só de `REVIEW`), emite `TASK_COMPLETED`. Drag Revisão→Done.
- **C. Reabertura por mensagem**: `POST /api/tasks/:id/messages` →
  `appendUserMessage`; se em `REVIEW`, reabre para o Manager (`PENDING`),
  emitindo `MESSAGE_APPENDED` + `TASK_RESUMED`. Input de mensagem no chat.
- **D. Cancel**: `cancelTask` aborta run em andamento e dequeue (sem execução
  fantasma), `TASK_CANCELLED`. `DELETE` e `PATCH {status:CANCELLED}` usam o
  mesmo caminho. Coluna **Cancel** após Done; drag para Cancel cancela.
- **E. Arquivar**: botão no header de Done/Cancel → modal de confirmação →
  `POST /api/tasks/archive {status}` → `archiveByStatus` move a família de
  arquivos para `_archived`, remove do estado/snapshot e emite `TASK_ARCHIVED`.
- **F. Subtask concluída**: colunas de agente filtram `status !== COMPLETED`;
  Revisão/Done/Cancel mostram apenas raízes (`!parentId`). Subtasks concluídas
  permanecem no summary/workflow.

## Matriz de validação

| Cenário | Front | Back/Evento | Snapshot | Status | Evidência |
|---|---|---|---|---|---|
| Criar task em Inbox | card Inbox, sem exec | `TASK_CREATED` | task PENDING | ✅ | API `201` + WS `TASK_CREATED hasTask st=PENDING` |
| Criar no Manager (execute=true) | vai p/ Manager | `TASK_CREATED`+`TASK_QUEUED` | QUEUED | ✅ (unit) | testes orquestrator |
| Inbox → Manager (drag) | re-schedule | `TASK_UPDATED` | reassign+QUEUED | ✅ (preexistente) | `moveTask` |
| Manager → Inbox (drag) | pausa | `TASK_PAUSED` | PENDING/inbox | ✅ (preexistente) | `moveTask`/`dequeue` |
| Manager decompõe | subtasks por agente | `SUBTASK_CREATED` | subtasks | ✅ (unit) | testes orquestrator |
| Subtask inicia/conclui | some da coluna | `TASK_COMPLETED` | COMPLETED | ✅ | filtro `status!==COMPLETED` |
| Manager conclui raiz | vai p/ Revisão | `TASK_REVIEW` | REVIEW | ✅ (unit) | teste "Manager root goes to REVIEW" |
| Revisão → Done | COMPLETED | `TASK_COMPLETED` | COMPLETED | ✅ (unit) | teste `completeTaskByUser` |
| Revisão + mensagem | volta a executar | `MESSAGE_APPENDED`+`TASK_RESUMED` | PENDING/Manager | ✅ (unit) | teste reopen |
| Qualquer → Cancel | CANCELLED, worker parado | `TASK_CANCELLED`(+`RUN_CANCELLED`) | CANCELLED | ✅ | WS live + teste |
| Arquivar Done/Cancel | somem do board | `TASK_ARCHIVED` | removidas | ✅ | WS live + `_archived` + `GET` total 0 |
| Editar runtimeConfig | reflete | `TASK_UPDATED` | runtimeConfig | ✅ | `updateTaskRuntimeConfig` emite evento |
| Enviar mensagem (ativa) | chat sem duplicar | `MESSAGE_APPENDED` | chat | ✅ | endpoint live (append) |
| Upload de anexo | persistido | — | — | ⚠️ não revalidado | inalterado (preexistente) |
| Reconexão WS | re-hidrata por snapshot | `state` | snapshot | ✅ | `onState`→`metadataToTask` |

## Arquivos alterados

Backend:
- `src/domain/types.ts` — status `REVIEW`; eventos `TASK_REVIEW`, `TASK_ARCHIVED`.
- `src/application/orquestrator.ts` — root do Manager→REVIEW; `cancelTask`,
  `completeTaskByUser`, `appendUserMessage`, `updateTaskRuntimeConfig`,
  `archiveByStatus`; replay de arquivadas; guard de título.
- `src/infrastructure/persistence/task-file-store.ts` — `archiveTask`.
- `src/infrastructure/api/routes/tasks.ts` — PATCH (complete/cancel), DELETE,
  `POST /messages`, `POST /archive`.
- `src/infrastructure/api/ws-server.ts` — broadcast enriquecido com metadata.
- `src/infrastructure/api/http-server.ts` — **fix do registro do /ws**.
- Testes: `src/__tests__/...` (lifecycle, contagem de eventos, tipos).

Frontend:
- `web/src/types/task.ts`, `.../StatusBadge.tsx`, `.../StatusDot.tsx`(×2) — REVIEW.
- `web/src/api/{client,ws-client,adapter}.ts` — endpoints, `task` no evento,
  `metadataToTask`.
- `web/src/stores/kanbanStore.ts` — `upsertTask`, `completeTask`, `sendMessage`,
  `archiveColumn`.
- `web/src/App.tsx`, `web/src/hooks/useWebSocket.ts` — push incremental (sem
  polling).
- `web/src/hooks/useDragAndDrop.ts`, `.../KanbanBoard.tsx`, `.../AgentColumn.tsx`,
  `.../TaskChatPanel.tsx` — colunas Revisão/Cancel, modal de arquivar, input.

## Verificação

- `tsc -p tsconfig.build.json`: OK; `npm test` (back): **294 passed**.
- `web: tsc -b`: OK; `web: npm test`: **53 passed**.
- WS push validado com cliente `ws` real (eventos enriquecidos + remoção).
- Endpoints validados via servidor real: create/cancel/archive/messages.

## Pendências

- **Fluxos que exigem o Pi/LLM em runtime** (decomposição do Manager, handoff
  real Manager→Revisão, retry/escalonamento) foram validados por testes
  unitários, não por execução com modelo real.
- **Upload de anexo** não foi revalidado (não tocado nesta entrega).
- `archiveByStatus` arquiva por status de coluna; não há "desarquivar" (fora do
  escopo).
