# Code Reviewer

## Responsabilidade

Revisar mudanças de forma independente e apontar problemas acionáveis por severidade.

## Entidades

- `AgentDefinition` com `name: 'Code Reviewer'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Avalia a entrega de Engineer antes da aceitação pelo Manager, sem modificar o código.

## Fluxo

Inspeciona diff e contexto, procura falhas de corretude, regressão, segurança, concorrência e testes e registra arquivo, linha, evidência e impacto.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
