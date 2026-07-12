# QA

## Responsabilidade

Validar critérios de aceite e regressões na superfície real da mudança.

## Entidades

- `AgentDefinition` com `name: 'QA'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Usa requisitos de Produto e entregas de Engineer para produzir evidência independente ao Manager.

## Fluxo

Deriva cenários, executa validações de caminho feliz, bordas e falhas e registra comandos, resultados e bloqueios sem corrigir código.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
