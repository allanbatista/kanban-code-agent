---
fase: F6
slug: 06-comms-and-human-in-the-loop
status: pending
depends_on: [F0, F1, F2, F5]
---

# F6 — Comunicação pelo Chat, Escalonamento, HITL e Artefatos do Humano (§9.3, §10.6)

**Status da fase:** `pending`
**Objetivo:** Completar o protocolo orientado a eventos do §9.3 **mantendo o chat como a ÚNICA interface agente↔humano**: um filho pode **perguntar ao pai** (e escalar para avô/Produto/Usuário) via o chat + eventos de orquestração enquanto **desidrata**; o pai acorda num **escopo isolado de resposta**; o humano responde **pelo próprio chat**; há **timeout de governança** que estaciona o card em **`SUSPENDED`** (§10.6); e o humano pode **anexar artefatos** ao chat (na criação **e** durante a conversa).
**Depende de:** F0, F1, F2, F5.

## Princípio que rege esta fase (correção de design)

**O chat é o único canal agente↔humano.** A conversa (pergunta do agente, resposta do humano, progresso, resultado, artefatos) vive sempre no log de chat da task (`task.chat`, roles `system|user|assistant|event`, evento `MESSAGE_APPENDED`). **Os eventos apenas orquestram estado** (`WAITING(human)`, `SUSPENDED`, timeout) — **não** há um objeto/canal paralelo de pergunta/resposta. Isto corrige a versão anterior deste plano, que propunha `QUESTION_ASKED`/`ANSWER_RECEIVED` + `POST /:id/answer` (dois fontes de verdade para a mesma conversa). Confirmado no código: o chat já é bidirecional (`postAgentMessage`→`MESSAGE_APPENDED`; `appendUserMessage` já reabre/retoma tasks em REVIEW/terminal, `orquestrator.ts:521,530-541`); não existe canal bespoke (grep `/answer`/`QUESTION_ASKED` = 0).

## Por que esta fase

A base resolve dependências **de dados** entre subtasks sem deadlock (wait groups), mas **não existe** o fluxo de **pergunta de esclarecimento** (§9.2/§9.3): grep 0 de `escalat`, nenhuma tool “perguntar”, nenhum `WAITING(human)`. E o humano só pode anexar arquivos **na criação** (`attachmentPaths`) — `appendUserMessage` aceita só string, sem upload mid-conversa, e não há endpoint multipart. Vem depois de F5 para que o gate de avaliação esteja firme antes de introduzir reativações parciais.

## Tasks

| Task | Descrição | Status |
| --- | --- | --- |
| F6.T1 | Tool `ask_human` — pergunta vai ao **chat** (assistant msg); estado vira `WAITING(human)` por evento de orquestração; escalonamento como atributo de roteamento | `pending` |
| F6.T2 | Despertar do pai em escopo isolado (sem conclusão global em wake parcial) | `pending` |
| F6.T3 | Resposta humana pelo **chat existente** (`POST /messages`→`appendUserMessage`) retoma `WAITING(human)`; timeout→`SUSPENDED` | `pending` |
| F6.T4 | Anexos do humano: criação **e** mid-conversa (upload multipart, evented) + reidratação no contexto do agente | `pending` |
| F6.T5 | Testes mock + e2e (anti-deadlock, escalonamento, timeout, anexos) | `pending` |

### F6.T1 — Tool `ask_human` (pergunta pelo chat)  ·  `pending`
- **O que:** Tool de orquestração que escreve a pergunta como **mensagem `assistant` no chat** via o caminho existente `postAgentMessage` (→ `appendChat('assistant','text',pergunta)` + `MESSAGE_APPENDED`), e então **parka o card** em `WAITING(human)` (de F1) e o desidrata (libera o worker) com um **evento de orquestração sem corpo de mensagem** (reusar `TASK_WAITING` com `payload.waitingReason='human'`, ou `TASK_AWAITING_HUMAN` sem texto — o texto já está no chat). Destino (`parent`|`product`|`user`) é **atributo de roteamento** do wait, não um canal separado. Se o pai não souber, escala recursivamente para cima e por fim a Produto/Usuário, **sem empilhar threads** (cada nível é evento + desidratação). Idempotente; respeita profundidade.
- **Toca:** `orquestrator.ts` (`buildAgentTools` + handler, reusa `postAgentMessage`), `src/domain/events.ts` (evento de estado, **sem** payload de Q&A).
- **Testes (mock):** `ask_human` → pergunta aparece como `MESSAGE_APPENDED` assistant + status `WAITING(human)`, worker liberado; escalonamento sobe 2 níveis até o usuário sem run ativo em nenhum nível.
- **DoD:** a pergunta é **uma mensagem de chat**; o evento só carrega estado; escalonamento limpo. `ponytail:` nenhum objeto de pergunta paralelo.

### F6.T2 — Escopo isolado de resposta do pai  ·  `pending`
- **O que:** Quando o destino é a Task-Pai, o Harness reativa o pai num **sub-turno de esclarecimento**: injeta a pergunta no topo do contexto; o pai responde **apenas** isso (não reavalia se sua task global terminou — **não pode** emitir `completed` num wake parcial); a resposta é uma mensagem de chat no filho, que volta a `Aguardando Execução`; o pai retorna ao estado desidratado de onde veio.
- **Toca:** `orquestrator.ts` (modo de run “answer-scope”), `prompt-builder.ts`.
- **Testes (mock):** filho pergunta → pai acorda só p/ responder → filho retoma; status global do pai intacto; **anti-deadlock**: pai aguardando o próprio filho que pergunta ao pai — ambos progridem.
- **DoD:** escopo isolado garantido; sem deadlock (teste dedicado).

### F6.T3 — Resposta humana pelo chat + timeout  ·  `pending`
- **O que:** O humano responde pelo **endpoint de chat existente** `POST /api/tasks/:taskId/messages` → `appendUserMessage`. **Generalizar `appendUserMessage`** (`orquestrator.ts:521-546`) para, além de reabrir roots em REVIEW/terminal, também **retomar uma task em `WAITING(human)`** — incluindo **subtasks** (remover o guard `!task.options.parentId` para o caso `WAITING(human)`, senão um filho que perguntou nunca é respondido). Manter validação zod em `/messages`. O **timeout** (`SWARM_HUMAN_TIMEOUT_MS`) sem resposta → `SUSPENDED` é **orquestração** que observa chat/status; resposta tardia reativa.
- **Toca:** `src/infrastructure/api/routes/tasks.ts` (reusa `/messages`, **sem** `/answer`), `orquestrator.ts` (`appendUserMessage` generalizado, timer/transição), `scheduler.ts`.
- **Testes (mock):** mensagem do usuário em `WAITING(human)` retoma a task (root **e** subtask); sem resposta no prazo → `SUSPENDED` + evento; resposta depois reativa.
- **DoD:** resposta humana é uma mensagem de chat; **nenhum endpoint `/answer` dedicado**; timeout estaciona limpo e reversível.

### F6.T4 — Anexos do humano (criação + mid-conversa, evented)  ·  `pending`
- **O que:** Hoje o humano só anexa **na criação** via `attachmentPaths` (caminhos server-side, não upload). Entregar: (a) **transporte de upload real** — registrar `@fastify/multipart` e `POST /api/tasks/:id/attachments` (e aceitar multipart no `POST /api/tasks`), gravando bytes na `attachments/` da task via novo método de `TaskFileStore` (write-from-stream, UUID-prefixado) em vez de `copyFileSync` de caminho do cliente; validar tamanho/mime + quota na borda. (b) **Anexo mid-conversa** — estender `appendUserMessage(taskId, message, attachments?)` e o `messageBody`/`POST /messages` para carregar anexos, chamando `appendChat('user','text',message,undefined,attachments)`. (c) **Evento** — `MESSAGE_APPENDED` inclui os anexos no payload (anexo do humano vira durável/replayável). (d) **Reidratação** — corrigir `prompt-builder.ts:62-64` para emitir caminho resolvível pelo cwd do agente (=taskDir) **ou** instruir o agente (resourceLoader/SYSTEM) que os anexos vivem em `attachments/` e como lê-los.
- **Toca:** `routes/tasks.ts`, `orquestrator.ts` (`appendUserMessage`), `task-file-store.ts` (write-from-stream), `domain/task.ts` (já suporta `AttachmentRef`), `prompt-builder.ts`, `pi-client.ts` (resourceLoader).
- **Testes (mock + e2e):** upload na criação e mid-chat → `AttachmentRef` persistido em `attachments/`; `MESSAGE_APPENDED` carrega anexos; chat.jsonl + ledger refletem; replay pós-restart preserva; agente consegue ler o anexo durante o run; rejeição de path-traversal/tamanho.
- **DoD:** humano anexa na criação **e** durante a conversa; anexo é evento durável; agente acessa o conteúdo.

### F6.T5 — Testes mock + e2e  ·  `pending`
- **O que:** Cobrir: pergunta ao pai (escopo isolado), escalonamento até usuário, timeout→suspensão, anti-deadlock, e anexos do humano. 1 e2e pela borda real: criar task com anexo → agente mock pergunta (mensagem de chat) → pergunta chega via WS → humano responde por `POST /messages` (com anexo) → task retoma e conclui.
- **Toca:** `src/__tests__/application/ask-escalation.test.ts` (novo), `src/__tests__/e2e/human-question.e2e.test.ts` (novo).
- **Testes:** este é o teste.
- **DoD:** fluxo completo, anti-deadlock e anexos comprovados; e2e verde.

## Pontos de validação cobertos

- **Chat como canal único:** pergunta/resposta são mensagens de chat (`MESSAGE_APPENDED`); eventos só orquestram estado.
- **Anti-deadlock (§9.2/§9.3):** teste dedicado prova pergunta + espera de subtask coexistindo sem travar.
- **Front↔Backend↔Agent:** pergunta nasce no agente (chat), chega ao humano (WS), volta por `/messages`, reativa o agente; anexo do humano atravessa front→back→fs→agente.
- **Backend↔Filesystem:** mensagens, anexos, timeout são eventos/arquivos duráveis.

## Critérios de saída (DoD da fase)

- [ ] F6.T1…F6.T5 em `done`.
- [ ] **Chat é a única interface agente↔humano**; nenhum canal/endpoint `/answer` paralelo; eventos só orquestram estado.
- [ ] Pergunta/resposta orientadas a eventos, **sem espera síncrona**, livre de deadlock; escalonamento + `SUSPENDED` por timeout reversíveis.
- [ ] Pai em escopo isolado não declara conclusão global em wake parcial.
- [ ] Humano anexa artefatos na criação **e** mid-conversa (upload real, evented, lido pelo agente).
- [ ] `npm test` verde (mock + e2e); `typecheck`+`lint` limpos.
- [ ] **`ponytail-review`** sobre o diff; achados endereçados/justificados.
</content>
