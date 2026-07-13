# Ciclo de vida da task

## Responsabilidade

Definir estados, transições automáticas e overrides explícitos feitos pelo usuário.

## Entidades

- `Task` e seu `status`.
- `TASK_STATUS` e `SWARM_EVENT_TYPE`.
- Eventos append-only e snapshots reconstruíveis.

## Relações

`Orquestrator` altera a task, emite o evento correspondente e persiste a projeção usada pela API após refresh ou restart.

## Fluxo

- `FAILED`, `COMPLETED` e `CANCELLED` não possuem transições automáticas de saída.
- Cancelamento do usuário é um override explícito: `FAILED` pode virar `CANCELLED`.
- Cancelar `COMPLETED` ou `CANCELLED` é idempotente e não muda o estado.
- `TASK_CANCELLED` reidrata a task como `CANCELLED` no replay.

## Fontes no codigo

- `src/domain/state-machine.ts`
- `src/domain/task.ts`
- `src/domain/types.ts`
- `src/application/orquestrator.ts`
- `src/infrastructure/api/routes/tasks.ts`
