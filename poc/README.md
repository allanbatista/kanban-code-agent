# Swarm PoC

PoC simples de swarm multi-agent/task em um unico arquivo: `index.ts`.

## Uso do CLI

```bash
rtk npm start -- "Titulo da task"
rtk npm start -- --attach ./arquivo.txt --attach ./imagem.png "Titulo da task"
rtk npm start -- --model balanced --effort low "Titulo da task"
rtk npm start -- --simulate-restart "Titulo da task"
```

Requer `OPENROUTER_API_KEY`.

## Arquitetura

- `Orquestrator` cria tasks, agenda execucoes, persiste estado e emite eventos de conclusao.
- `Task` contem titulo, status, chat, subtasks, runs de orquestracao, artefatos e sessao Pi persistida.
- `PiAgentClient` executa agents com ferramentas de leitura, `create_subtask` e `create_artifact`.
- Estado global: `.swarm-state.json`.
- Arquivos por task: `tasks/{task_id}/task.yml`, `chat.jsonl`, `session.jsonl`, `attachments/`, `artifacts/`, `artifacts.yaml`.

## Regras

- Tasks nao tem descricao; a interface da task e exclusivamente o chat.
- Mensagens usam `role` e `type`.
- Attachments do usuario entram apenas na criacao da task pelo CLI.
- Attachments sao copiados para `tasks/{task_id}/attachments/{uuid}-{original name}`.
- Agents retornam `messages[]` para `completed`, `waiting` e `retry`.
- `waiting` aceita `waitGroups[]` para misturar grupos `WAIT_ALL` e `ON_DEMAND` na mesma task.
- `WAIT_ALL` entrega os resultados do grupo juntos quando todas as subtasks completarem.
- `ON_DEMAND` entrega cada subtask concluida individualmente.
- Logs do terminal exibem heartbeat da sessao Pi, duracao de cada task, eventos recebidos, mensagens formatadas e o grupo/mode associado a cada subtask quando o run e criado.
- Agents criam artefatos somente via `create_artifact`.
- Artefatos ficam em `tasks/{task_id}/artifacts/` e sao indexados em `artifacts.yaml`.
- Caminhos persistidos em estado, chat, YAML, attachments e artifacts sao relativos ao diretorio da propria task.
- `task_dir` nao e persistido nem exposto; o diretorio da task e inferido em runtime por `tasks/{task_id}`.
- Nao ha compatibilidade com estados antigos.

## Definicoes

- `AttachmentRef`: `{ id, originalName, path }`.
- `TaskArtifact`: `{ description, file_type, path }`.
- `TaskChatMessage`: `{ ts, role, type, text?, attachments?, artifacts?, runtimeConfig? }`.
- `WaitGroup`: `{ waitId, mode, taskIds, processedEventIds, status }`.
- `TaskRun`: `{ runId, status, waitGroups, resultMessages, createdAt, completedAt? }`.
- `AgentDecision`: JSON com `status` e `messages[]`; `waiting` deve incluir `waitGroups`; `retry` pode incluir `instructions`, `model` e `effort`.

Exemplo de `waiting`:

```json
{
  "status": "waiting",
  "waitGroups": [
    { "waitId": "telas", "mode": "WAIT_ALL", "taskIds": ["s1", "s2"] },
    { "waitId": "stream", "mode": "ON_DEMAND", "taskIds": ["s3", "s4"] }
  ],
  "messages": [{ "type": "text", "text": "aguardando grupos" }]
}
```
