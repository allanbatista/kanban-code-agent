# Testes Unitarios - Camada de Aplicacao Phase 2

Date: 2026-06-16

## Changed

- Criados 4 novos arquivos de teste unitario para a camada de aplicacao usando Vitest
- Orquestrator: 48 testes cobrindo construtor, addTask, spawnSubtask, maquina de estados, WAIT_ALL, ON_DEMAND, retry, technical retry, deteccao de ciclo, shutdown, crash recovery, persistencia, metadata, reporting
- Scheduler: 24 testes cobrindo rebuildWaitIndex, scheduleWaitersForEvent, getReadyEvents (WAIT_ALL, ON_DEMAND, failed/cancelled priority)
- WorkerPool: 11 testes cobrindo limite de concorrencia, timeout, cancel, cancelAll, contagens active/pending
- PromptBuilder: 26 testes cobrindo idempotencia, metadados, eventos trigger, efeitos colaterais, runs, chat truncation

## Files

- `src/__tests__/application/orquestrator.test.ts`: 48 testes, usa tmpdir com stores reais e mock AgentRunner
- `src/__tests__/application/scheduler.test.ts`: 24 testes, testa logica pura de index de dependencia
- `src/__tests__/application/worker-pool.test.ts`: 11 testes, testa controle de concorrencia assincrono
- `src/__tests__/application/prompt-builder.test.ts`: 26 testes, verifica idempotencia e imutabilidade

## Validation

- `npx vitest run src/__tests__/application/` - 156 tests passed, 6 files
