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
- `Task` contem titulo, status, chat, subtasks, artefatos e sessao Pi persistida.
- `PiAgentClient` executa agents com ferramentas de leitura, `create_subtask` e `create_artifact`.
- Estado global: `.swarm-state.json`.
- Arquivos por task: `tasks/{task_id}/task.yml`, `chat.jsonl`, `session.jsonl`, `attachments/`, `artifacts/`, `artifacts.yaml`.

## Regras

- Tasks nao tem descricao; a interface da task e exclusivamente o chat.
- Mensagens usam `role` e `type`.
- Attachments do usuario entram apenas na criacao da task pelo CLI.
- Attachments sao copiados para `tasks/{task_id}/attachments/{uuid}-{original name}`.
- Agents retornam `messages[]` para `completed`, `waiting` e `retry`.
- Agents criam artefatos somente via `create_artifact`.
- Artefatos ficam em `tasks/{task_id}/artifacts/` e sao indexados em `artifacts.yaml`.
- Caminhos persistidos em estado, chat, YAML, attachments e artifacts sao relativos ao diretorio da propria task.
- `task_dir` nao e persistido nem exposto; o diretorio da task e inferido em runtime por `tasks/{task_id}`.
- Nao ha compatibilidade com estados antigos.

## Definicoes

- `AttachmentRef`: `{ id, originalName, path }`.
- `TaskArtifact`: `{ description, file_type, path }`.
- `TaskChatMessage`: `{ ts, role, type, text?, attachments?, artifacts?, runtimeConfig? }`.
- `AgentDecision`: JSON com `status` e `messages[]`; `waiting` pode incluir `waitMode` e `waitingForTaskIds`; `retry` pode incluir `instructions`, `model` e `effort`.
