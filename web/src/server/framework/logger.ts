/**
 * Minimal drop-in replacement for `@nestjs/common`'s `Logger`.
 *
 * Only the surface actually used by this codebase is implemented
 * (`log` / `warn` / `error` / `debug` / `verbose`, instance and static), with
 * the same "optional context suffix" ergonomics. Output goes to the standard
 * console streams so container log collectors keep working unchanged.
 */

type LogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

/** Levels silenced by default outside development, matching Nest's behaviour. */
const NOISY_LEVELS: readonly LogLevel[] = ['debug', 'verbose'];

function isSilenced(level: LogLevel): boolean {
  if (process.env.NODE_ENV === 'test' || process.env.LOG_SILENT === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production' && NOISY_LEVELS.includes(level);
}

function emit(level: LogLevel, context: string | undefined, args: unknown[]): void {
  if (isSilenced(level)) {
    return;
  }
  const timestamp = new Date().toISOString();
  const prefix = context ? `[${timestamp}] [${context}]` : `[${timestamp}]`;
  const sink =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : level === 'debug' || level === 'verbose'
          ? console.debug
          : console.log;
  sink(prefix, ...args);
}

export class Logger {
  constructor(private readonly context?: string) {}

  log(...args: unknown[]): void {
    emit('log', this.context, args);
  }

  error(...args: unknown[]): void {
    emit('error', this.context, args);
  }

  warn(...args: unknown[]): void {
    emit('warn', this.context, args);
  }

  debug(...args: unknown[]): void {
    emit('debug', this.context, args);
  }

  verbose(...args: unknown[]): void {
    emit('verbose', this.context, args);
  }

  static log(...args: unknown[]): void {
    emit('log', undefined, args);
  }

  static error(...args: unknown[]): void {
    emit('error', undefined, args);
  }

  static warn(...args: unknown[]): void {
    emit('warn', undefined, args);
  }

  static debug(...args: unknown[]): void {
    emit('debug', undefined, args);
  }

  static verbose(...args: unknown[]): void {
    emit('verbose', undefined, args);
  }
}
