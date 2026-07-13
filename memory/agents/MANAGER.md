# Manager

## Responsabilidade

Decompor objetivos, delegar trabalho, acompanhar dependências e consolidar entregas verificadas.

## Entidades

- `AgentDefinition` com `name: 'Manager'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Coordena as demais personas por subtasks e valida seus resultados antes da conclusão.

## Fluxo

Recebe o objetivo, cria subtasks adequadas, acompanha eventos e wait groups, valida evidências e consolida o resultado.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
