# API de agentes

## Responsabilidade

Expor os agents de runtime e permitir atualizar sua configuração e instrução especializada.

## Entidades

- `Agent` armazenado em `Orquestrator.agents`.
- Resposta com `name`, `role`, `systemPrompt`, `runtimeConfig` e `tools`.

## Relações

As rotas leem e alteram o mesmo `Agent` consumido por `PiAgentClient`; por isso, atualizar `systemPrompt` afeta os próximos runs Pi e Codex.

## Fluxo

- `GET /api/agents` lista os agents.
- `GET /api/agents/:name` retorna um agent.
- `PATCH /api/agents/:name` valida e atualiza `runtimeConfig`, `role` ou `systemPrompt`.
- `role` permanece o rótulo curto; `systemPrompt` contém a persona efetiva.

## Fontes no codigo

- `src/infrastructure/api/routes/agents.ts`
- `src/application/pi-client.ts`
- `src/domain/agent.ts`
