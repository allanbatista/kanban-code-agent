# Architecture

## Responsabilidade

Definir o menor desenho técnico coerente com o fluxo e os contratos existentes.

## Entidades

- `AgentDefinition` com `name: 'Architecture'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Traduz requisitos de Produto em decisões técnicas consumidas por Engineer e verificadas por Code Reviewer e QA.

## Fluxo

Mapeia o sistema atual, avalia riscos e trade-offs e descreve contratos, falhas, segurança, migração e validação sem implementar.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
