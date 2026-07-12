# Generic

## Responsabilidade

Executar apoio simples, mecânico e estritamente delimitado.

## Entidades

- `AgentDefinition` com `name: 'Generic'` e `systemPrompt` especializado.
- `Agent` de runtime criado pelo factory.

## Relações

Atende tarefas triviais delegadas pelo Manager e escala trabalho que exija uma persona especializada.

## Fluxo

Inspeciona o alvo, aplica a menor alteração exata, valida o resultado e interrompe quando encontra decisão de domínio, arquitetura ou risco.

## Fontes no codigo

- `src/infrastructure/agents/index.ts`
- `src/application/pi-client.ts`
