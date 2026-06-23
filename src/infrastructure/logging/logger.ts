type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  namespace: string;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export class Logger {
  private minLevel: LogLevel;

  constructor(
    private readonly namespace: string,
    minLevel: LogLevel = 'info',
  ) {
    this.minLevel = minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.log('trace', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.log('error', message, context, error);
  }

  fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    this.log('fatal', message, context, error);
  }

  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`, this.minLevel);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      namespace: this.namespace,
      ...(context ? { context } : {}),
      ...(error ? { error: error instanceof Error ? error.stack ?? error.message : String(error) } : {}),
    };

    // Structured JSON output to stdout
    process.stdout.write(JSON.stringify(entry) + '\n');
  }
}

export function createLogger(namespace: string, level?: LogLevel): Logger {
  return new Logger(namespace, level);
}
