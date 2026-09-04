/**
 * Replacement for `@nestjs/config`'s `registerAs` + `ConfigService`.
 *
 * The existing config factories in `src/server/config/*.ts` are untouched:
 * they still call `registerAs('app', () => ({ ... }))`. Here `registerAs`
 * simply tags the factory function with its namespace token, and
 * {@link ConfigService} merges every registered namespace into a single
 * object that is queried with the same dotted-path syntax Nest uses
 * (`configService.get<number>('app.port', 3001)`).
 */

/** A namespaced configuration factory produced by {@link registerAs}. */
export interface ConfigFactory<T = Record<string, unknown>> {
  (): T;
  KEY: string;
}

/**
 * Declares a namespaced configuration factory.
 *
 * Mirrors `@nestjs/config`'s signature so the existing `config/*.ts` files
 * compile without modification.
 */
export function registerAs<T extends Record<string, unknown>>(
  namespace: string,
  factory: () => T,
): ConfigFactory<T> {
  const wrapped = (() => factory()) as ConfigFactory<T>;
  wrapped.KEY = namespace;
  return wrapped;
}

/** Reads a dotted path (`a.b.c`) out of a nested plain object. */
function readPath(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Configuration reader.
 *
 * Instances are cheap and immutable: the namespaces are evaluated once at
 * construction, exactly like Nest's `ConfigModule.forRoot({ load: [...] })`.
 * The `get` overloads reproduce Nest's behaviour, including returning the
 * supplied default when a key is absent (`undefined`).
 */
export class ConfigService {
  private readonly store: Record<string, unknown>;

  constructor(factories: ConfigFactory<never>[] | Record<string, unknown> = []) {
    if (Array.isArray(factories)) {
      const store: Record<string, unknown> = {};
      for (const factory of factories) {
        store[factory.KEY] = factory();
      }
      this.store = store;
    } else {
      this.store = factories;
    }
  }

  get<T = unknown>(path: string): T | undefined;
  get<T = unknown>(path: string, defaultValue: T): T;
  get<T = unknown>(path: string, defaultValue?: T): T | undefined {
    const value = readPath(this.store, path);
    // `null` is a meaningful configured value (e.g. an explicitly disabled
    // option); only a genuinely absent key falls back to the default.
    return value === undefined ? defaultValue : (value as T);
  }

  /** Returns the whole resolved configuration tree (used by diagnostics). */
  getAll(): Record<string, unknown> {
    return this.store;
  }
}
