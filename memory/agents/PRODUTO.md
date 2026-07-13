# Produto

## Responsabilidade

Transformar intenção do usuário em escopo, regras de negócio e critérios de aceite verificáveis.

## Entidades

- `AgentDefinition` com `name: 'Produto'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Fornece o contrato de produto que orienta Architecture, Engineer e QA.

## Fluxo

Analisa o pedido, explicita regras e casos de borda, limita o escopo e registra somente decisões realmente pendentes.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
