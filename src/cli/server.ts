import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SwarmConfig } from '../infrastructure/config.js';
import { createLogger } from '../infrastructure/logging/logger.js';
import { startServer } from '../infrastructure/api/http-server.js';
import { createOrquestrator } from './orquestrator-factory.js';

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function readVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printBanner(config: SwarmConfig, version: string): void {
  const staticDir = resolve('web/dist');
  const hasUi = existsSync(staticDir);

  const lines = [
    '',
    '  ==============================================================',
    `   Swarm API Server v${version}`,
    '  ==============================================================',
    `   URL:        http://127.0.0.1:${config.port}`,
    `   Data dir:   ${config.dataDir}`,
    `   UI:         ${hasUi ? staticDir : '(nao encontrado - web/dist)'}`,
    `   Models:     fast=${config.models.fast.provider}/${config.models.fast.modelId}`,
    `               balanced=${config.models.balanced.provider}/${config.models.balanced.modelId}`,
    `               deep=${config.models.deep.provider}/${config.models.deep.modelId}`,
    '  ==============================================================',
    '',
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Server mode
// ---------------------------------------------------------------------------

export async function runServer(config: SwarmConfig): Promise<void> {
  const logger = createLogger('swarm', config.logLevel as 'info');
  const version = readVersion();

  const orquestrator = await createOrquestrator(config);

  const staticDir = resolve('web/dist');
  const staticDirOpt = existsSync(staticDir) ? staticDir : undefined;

  const serverOptions = {
    port: config.port,
    host: '127.0.0.1' as const,
    staticDir: staticDirOpt,
  };

  // startServer creates and returns the Fastify instance after listening
  const server = await startServer(orquestrator, logger, serverOptions);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Recebido sinal de desligamento...');
    orquestrator.shutdown();
    await server.close();
    logger.info('Servidor encerrado.');
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  printBanner(config, version);
}
