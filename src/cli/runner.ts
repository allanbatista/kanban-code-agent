import type { RuntimeConfig } from '../domain/task.js';
import type { SwarmConfig } from '../infrastructure/config.js';
import { createOrquestrator } from './orquestrator-factory.js';

// ---------------------------------------------------------------------------
// Helper to produce a human-readable model label
// ---------------------------------------------------------------------------

function modelLabel(config: Required<RuntimeConfig>, swarmConfig: SwarmConfig): string {
  const model = swarmConfig.models[config.model];
  return model ? `${model.provider}/${model.modelId}` : config.model;
}

// ---------------------------------------------------------------------------
// Runner mode: execute single task and print summary
// ---------------------------------------------------------------------------

export async function runTask(
  title: string,
  runtimeConfig?: RuntimeConfig,
  attachmentPaths: string[] = [],
  simulateRestart = false,
): Promise<void> {
  if (simulateRestart) {
    await runRestartSimulation(title, runtimeConfig, attachmentPaths);
    return;
  }
  await runNormal(title, runtimeConfig, attachmentPaths);
}

// ---------------------------------------------------------------------------
// Normal execution
// ---------------------------------------------------------------------------

async function runNormal(
  title: string,
  runtimeConfig?: RuntimeConfig,
  attachmentPaths: string[] = [],
): Promise<void> {
  const orquestrator = await createOrquestrator(undefined, { resetState: true });
  const mainTask = orquestrator.addTask({ message: title, title, execute: true, runtimeConfig, attachmentPaths });

  console.log('=============== EXECUTANDO TASK ===============');
  console.log(`Task: ${title}`);
  if (runtimeConfig) {
    console.log(`Config: model=${runtimeConfig.model ?? 'default'}, effort=${runtimeConfig.effort ?? 'default'}`);
  }

  await orquestrator.waitUntilSettled(mainTask);

  console.log('\n================== FINALIZADO ==================');
  console.log('Status Final:', mainTask.status);
  if (mainTask.resultMessages?.length) {
    console.log('Resultado:', mainTask.resultMessages.map((msg) => msg.text ?? '').join(' | '));
  }

  orquestrator.printExecutionReport();
  orquestrator.shutdown();
}

// ---------------------------------------------------------------------------
// Restart simulation
// ---------------------------------------------------------------------------

async function runRestartSimulation(
  title: string,
  runtimeConfig?: RuntimeConfig,
  attachmentPaths: string[] = [],
): Promise<void> {
  // Fase 1: executa ate suspender e persiste estado
  console.log('[SIM] Fase 1: executando ate suspender e persistir estado.');
  const firstRun = await createOrquestrator(undefined, { resetState: true, stopWhenWaiting: true });
  const firstTask = firstRun.addTask({ message: title, title, execute: true, runtimeConfig, attachmentPaths });
  await firstRun.waitUntilSettled(firstTask);
  firstRun.shutdown();
  console.log('[SIM] Crash simulado. Estado persistido em .swarm/');

  // Fase 2: novo orquestrador carregando estado persistido
  console.log('[SIM] Fase 2: novo orquestrador carregando estado persistido.');
  const secondRun = await createOrquestrator();
  const resumedTask = secondRun.getRootTask();
  if (!resumedTask) {
    throw new Error('Nenhuma root task persistida para retomar');
  }
  secondRun.scheduleReadyTasks();
  await secondRun.waitUntilSettled(resumedTask);

  console.log('\n================== FINALIZADO ==================');
  console.log('Status Final:', resumedTask.status);
  if (resumedTask.resultMessages?.length) {
    console.log('Resultado:', resumedTask.resultMessages.map((msg) => msg.text ?? '').join(' | '));
  }

  secondRun.printExecutionReport();
  secondRun.shutdown();
}
