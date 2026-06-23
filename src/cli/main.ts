import type { RuntimeConfig } from '../domain/task.js';
import type { ModelAlias, EffortLevel } from '../domain/types.js';
import { MODEL_ALIAS, EFFORT_LEVEL } from '../domain/types.js';
import { loadConfig } from '../infrastructure/config.js';
import { runServer } from './server.js';
import { runTask } from './runner.js';

// ---------------------------------------------------------------------------
// Parsed CLI args
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: 'server' | 'run' | 'help';
  title?: string;
  model?: ModelAlias;
  effort?: EffortLevel;
  attach: string[];
  simulateRestart: boolean;
  port?: number;
  configPath?: string;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function showHelp(): void {
  const lines = [
    'Usage: swarm [command] [options]',
    '',
    'Commands:',
    '  server              Iniciar API server + servir UI',
    '  run <titulo>        Executar uma task isolada (runner mode)',
    '',
    'Options:',
    '  --model <alias>     Model alias: fast, balanced, deep',
    '  --effort <level>    Effort level: off, minimal, low, medium, high, xhigh',
    '  --attach <path>     Anexar arquivo a task (repetivel)',
    '  --simulate-restart  Simular crash e recovery',
    '  --port <number>     Sobrescrever porta do servidor',
    '  --config <path>     Caminho do arquivo de configuracao',
    '  --help              Mostrar ajuda',
    '',
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isModelAlias(value: unknown): value is ModelAlias {
  return typeof value === 'string' && value in MODEL_ALIAS;
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && value in EFFORT_LEVEL;
}

function parseModelAlias(value: string): ModelAlias {
  if (!isModelAlias(value)) {
    throw new Error(`Modelo alias invalido: ${value}. Permitidos: ${Object.keys(MODEL_ALIAS).join(', ')}`);
  }
  return value;
}

function parseEffortLevel(value: string): EffortLevel {
  if (!isEffortLevel(value)) {
    throw new Error(`Effort invalido: ${value}. Permitidos: ${Object.values(EFFORT_LEVEL).join(', ')}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// CLI parser
// ---------------------------------------------------------------------------

function parseCliArgs(args: string[]): ParsedArgs {
  const attach: string[] = [];
  const command: ParsedArgs['command'] = 'help';
  let title: string | undefined;
  const parsed: ParsedArgs = {
    command: 'help',
    attach,
    simulateRestart: false,
  };

  if (args.length === 0) {
    return parsed;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      parsed.command = 'help';
      return parsed;
    }

    if (arg === 'server') {
      parsed.command = 'server';
      continue;
    }

    if (arg === 'run') {
      parsed.command = 'run';
      // Collect remaining positional args as title
      const titleParts: string[] = [];
      let j = i + 1;
      while (j < args.length && !args[j].startsWith('-')) {
        titleParts.push(args[j]);
        j++;
      }
      parsed.title = titleParts.join(' ') || undefined;
      i = j - 1; // loop increment will advance past last title arg
      continue;
    }

    if (arg === '--simulate-restart') {
      parsed.simulateRestart = true;
      continue;
    }

    if (arg === '--model') {
      parsed.model = parseModelAlias(args[++i]);
      continue;
    }
    if (arg.startsWith('--model=')) {
      parsed.model = parseModelAlias(arg.slice('--model='.length));
      continue;
    }

    if (arg === '--effort') {
      parsed.effort = parseEffortLevel(args[++i]);
      continue;
    }
    if (arg.startsWith('--effort=')) {
      parsed.effort = parseEffortLevel(arg.slice('--effort='.length));
      continue;
    }

    if (arg === '--attach') {
      const path = args[++i];
      if (!path) throw new Error('--attach requer um caminho');
      attach.push(path);
      continue;
    }
    if (arg.startsWith('--attach=')) {
      attach.push(arg.slice('--attach='.length));
      continue;
    }

    if (arg === '--port') {
      const val = args[++i];
      const port = Number(val);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Porta invalida: ${val}`);
      }
      parsed.port = port;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const val = arg.slice('--port='.length);
      const port = Number(val);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Porta invalida: ${val}`);
      }
      parsed.port = port;
      continue;
    }

    if (arg === '--config') {
      parsed.configPath = args[++i];
      continue;
    }
    if (arg.startsWith('--config=')) {
      parsed.configPath = arg.slice('--config='.length);
      continue;
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Runtime config builder
// ---------------------------------------------------------------------------

function buildRuntimeConfig(parsed: ParsedArgs): RuntimeConfig | undefined {
  const rc: RuntimeConfig = {};
  if (parsed.model) rc.model = parsed.model;
  if (parsed.effort) rc.effort = parsed.effort;
  return Object.keys(rc).length > 0 ? rc : undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(args: string[]): Promise<void> {
  const parsed = parseCliArgs(args);

  if (parsed.command === 'help') {
    showHelp();
    return;
  }

  const config = loadConfig(parsed.configPath);

  if (parsed.port) {
    config.port = parsed.port;
  }

  if (parsed.command === 'server') {
    await runServer(config);
    return;
  }

  if (parsed.command === 'run') {
    const title = parsed.title;
    if (!title) {
      throw new Error('Comando "run" requer um titulo de task. Ex: swarm run "criar servidor http"');
    }
    const runtimeConfig = buildRuntimeConfig(parsed);
    await runTask(title, runtimeConfig, parsed.attach, parsed.simulateRestart);
    return;
  }
}
