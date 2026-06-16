# Proposta — PoC Robusta, Escalável e Event-Driven para Swarm de Agents

## 1. Objetivo

Evoluir a PoC atual mantendo **persistência em filesystem**, mas corrigindo falhas críticas de robustez, escalabilidade, segurança e performance.

A nova PoC deve continuar simples, versionável e fácil para agents/tools interagirem, porém com uma fundação mais próxima de produção:

- filesystem como fonte auditável/versionável;
- arquitetura orientada a eventos;
- execução concorrente com controle;
- recuperação segura após crash;
- sem deadlocks silenciosos;
- sem sucesso falso por JSON inválido;
- persistência incremental e atômica;
- performance alta sem bloquear o event loop.

---

## 2. Problemas críticos identificados

### 2.1 Persistência cara, bloqueante e não atômica

Hoje `persist()` faz:

- `ensureTaskArtifacts()` para **todas** as tasks;
- reescrita completa de `.swarm-state.json`;
- reescrita completa de `chat.jsonl`;
- I/O síncrono com `writeFileSync`, `readFileSync`, `mkdirSync`.

Problemas:

- bloqueia o event loop;
- escala mal com muitas tasks;
- aumenta latência;
- pode corromper arquivos se o processo cair durante escrita;
- torna cada mudança pequena uma operação O(n).

### 2.2 Scheduler baseado em varredura global

`scheduleReadyTasks()` percorre todas as tasks a cada mudança de estado.

Isso não escala. O correto é acordar apenas as tasks que dependem do evento recém-gerado.

### 2.3 Deadlock em waits

`WAIT_ALL` só desbloqueia quando todas as subtasks ficam `COMPLETED`.

Se uma subtask falhar, o parent pode ficar em `WAITING` para sempre.

Também há risco de o agent retornar:

- `taskIds` inexistentes;
- wait group vazio;
- self-wait;
- espera por task que não é subtask;
- ciclos de dependência.

### 2.4 JSON inválido vira sucesso

`parseDecision()` usa regex gulosa:

```ts
output.match(/\{[\s\S]*\}/)
```

E, em caso de erro, trata a saída como `completed`.

Isso é perigoso: uma falha contratual do agent vira sucesso silencioso.

### 2.5 IDs frágeis e profundidade acoplada ao formato do ID

Problemas:

- `createId()` usa `Math.random()`;
- `createSubtaskId()` usa apenas 2 caracteres aleatórios;
- `getTaskDepth()` depende de contar hífens no ID.

Isso gera risco de colisão e fragilidade estrutural.

### 2.6 Recuperação pós-crash incorreta

Hoje toda task `RUNNING` carregada do estado vira `WAITING`.

Isso é incorreto. Uma task que estava executando quando o processo caiu deve geralmente voltar para `PENDING`/`QUEUED`, salvo se estava realmente aguardando wait groups válidos.

### 2.7 `buildPrompt()` tem efeito colateral

`buildPrompt()` adiciona eventos ao chat antes de saber se o run será processado com sucesso.

Isso pode duplicar eventos, poluir histórico e quebrar idempotência em replay/retry.

### 2.8 Segurança de filesystem insuficiente

O sandbox de paths precisa ser mais rígido.

Riscos:

- path traversal em artifacts;
- paths absolutos;
- NUL byte;
- symlinks;
- paths carregados de snapshot adulterado;
- `piSessionFile` não validado;
- tools nativas `read`, `grep`, `find`, `ls` com `cwd` global podem ler arquivos sensíveis.

### 2.9 Ausência de limites operacionais

Faltam:

- limite de concorrência;
- timeout por run;
- retry técnico com backoff;
- budget de tokens/custo;
- limite de subtasks por task;
- limite de tamanho de artifact/attachment;
- cancelamento;
- shutdown gracioso.

---

## 3. Arquitetura proposta

Migrar de “estado global mutável salvo inteiro” para:

> **Event log append-only + projeções/snapshots reconstruíveis + scheduler indexado + worker pool.**

Estrutura sugerida:

```txt
.swarm/
  .swarm-root
  swarm.yml
  events/
    current.jsonl
  state.snapshot.json
  state.snapshot.json.bak
  logs/
    orchestrator.jsonl
  tasks/
    <taskId>/
      task.yml
      chat.jsonl
      session.jsonl
      artifacts.yaml
      summary.md
      attachments/
      artifacts/
      logs/
        runs.jsonl
        errors.jsonl
```

### Fonte da verdade

O arquivo principal deve ser:

```txt
.swarm/events/current.jsonl
```

Cada linha representa um evento imutável:

```json
{
  "seq": 42,
  "eventId": "evt_...",
  "type": "TASK_COMPLETED",
  "taskId": "task_...",
  "ts": "2026-01-01T00:00:00.000Z",
  "payload": {}
}
```

Snapshots e arquivos YAML são projeções reconstruíveis.

---

## 4. Eventos mínimos

Adicionar um modelo de eventos mais completo:

```ts
type SwarmEventType =
  | 'TASK_CREATED'
  | 'TASK_QUEUED'
  | 'TASK_STARTED'
  | 'TASK_WAITING'
  | 'TASK_RESUMED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELLED'
  | 'TASK_RETRY_REQUESTED'
  | 'TASK_RETRIED'
  | 'RUN_STARTED'
  | 'RUN_COMPLETED'
  | 'RUN_FAILED'
  | 'RUN_TIMEOUT'
  | 'WAIT_GROUP_REGISTERED'
  | 'WAIT_GROUP_READY'
  | 'WAIT_GROUP_PROCESSED'
  | 'SUBTASK_CREATED'
  | 'MESSAGE_APPENDED'
  | 'ARTIFACT_CREATED'
  | 'AGENT_OUTPUT_INVALID'
  | 'BUDGET_EXCEEDED';
```

Fluxo esperado:

```txt
TASK_CREATED

