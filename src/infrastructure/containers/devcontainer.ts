import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('devcontainer');
const require = createRequire(import.meta.url);

// bin do @devcontainers/cli resolvido de node_modules (sem npx em runtime).
function devcontainerCliBin(): string {
  const pkgPath = require.resolve('@devcontainers/cli/package.json');
  const pkg = require('@devcontainers/cli/package.json') as { bin: { devcontainer: string } };
  return resolve(dirname(pkgPath), pkg.bin.devcontainer);
}

interface DevcontainerConfig {
  image?: string;
  dockerComposeFile?: unknown;
  runArgs?: unknown;
  dockerFile?: string;
  build?: { dockerfile?: string };
}

export interface ResolveDevcontainerImageOptions {
  /** Raiz do worktree do projeto (workspace-folder do devcontainer). */
  workspaceFolder: string;
  /** Caminho absoluto do devcontainer.json. */
  configPath: string;
  /** Slug do projeto — entra no nome da imagem e nos erros/logs. */
  slug: string;
  dockerBin?: string;
  execFile?: typeof execFileSync;
}

/**
 * Constrói (ou reaproveita do cache) a imagem do devcontainer de um projeto via
 * `devcontainer build` e devolve a tag `kca-devc-<slug>-<hash>`. O run em si
 * continua sendo nosso `docker run` — por isso compose é erro e runArgs é
 * ignorado (decisão 6 do plano). Cache por hash do devcontainer.json + Dockerfile
 * referenciado: se `docker image inspect` acha a tag, pula o build.
 */
export function resolveDevcontainerImage(options: ResolveDevcontainerImageOptions): string {
  const { workspaceFolder, configPath, slug } = options;
  const execFile = options.execFile ?? execFileSync;
  const dockerBin = options.dockerBin ?? 'docker';

  const configText = readFileSync(configPath, 'utf-8');
  const config = parseJsonc(configText) as DevcontainerConfig;

  // compose/lifecycle fora de escopo: erro claro (o run é nosso docker run).
  if (config.dockerComposeFile) {
    throw new Error(
      `devcontainer do projeto "${slug}" usa dockerComposeFile — compose está fora de escopo (use "image" ou "build.dockerfile")`,
    );
  }
  // ponytail: runArgs é do fluxo `devcontainer up`, não do nosso docker run —
  // avisa e ignora em vez de falhar (limites/mounts nossos vencem).
  if (config.runArgs) {
    logger.warn(`devcontainer do projeto "${slug}" declara runArgs — ignorado (o run usa nosso docker run)`);
  }

  // Hash: devcontainer.json + Dockerfile referenciado (build muda -> imagem nova).
  let hashInput = configText;
  const dockerfile = config.build?.dockerfile ?? config.dockerFile;
  if (dockerfile) {
    const dockerfilePath = resolve(dirname(configPath), dockerfile);
    if (existsSync(dockerfilePath)) hashInput += readFileSync(dockerfilePath, 'utf-8');
  }
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, 12);
  const image = `kca-devc-${slug}-${hash}`;

  try {
    execFile(dockerBin, ['image', 'inspect', image], { stdio: ['ignore', 'ignore', 'ignore'] });
    logger.info(`devcontainer cache hit para "${slug}": ${image}`);
    return image;
  } catch {
    // tag ausente — segue para o build.
  }

  logger.info(`construindo imagem devcontainer para "${slug}": ${image}`);
  try {
    execFile(
      process.execPath,
      [devcontainerCliBin(), 'build', '--workspace-folder', workspaceFolder, '--config', configPath, '--image-name', image],
      // stdout herdado (progresso do build); stderr capturado para a msg de erro.
      { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    const detail = stderr?.trim() || (error instanceof Error ? error.message : String(error));
    throw new Error(`devcontainer build falhou para o projeto "${slug}": ${detail}`);
  }
  return image;
}

/**
 * Parser JSONC mínimo, ciente de strings: descarta comentários `//` e `/* *\/` e
 * vírgulas finais, sem quebrar `//` dentro de strings (ex.: URLs de features).
 */
function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (c === '/' && next === '*') {
      inBlock = true;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
