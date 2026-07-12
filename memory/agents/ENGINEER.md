# Engineer

## Responsabilidade

Implementar a menor alteração correta e segura, com validação proporcional ao risco.

## Entidades

- `AgentDefinition` com `name: 'Engineer'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Implementa os contratos definidos por Produto e Architecture; entrega evidências para Code Reviewer e QA.

## Fluxo

Rastreia o fluxo e a causa raiz, preserva mudanças alheias, aplica o diff mínimo, testa caminhos críticos e reporta resultado ou bloqueio real.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
