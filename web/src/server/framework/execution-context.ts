/**
 * Execution-context primitives.
 *
 * The guards (`JwtAuthGuard`, `RolesGuard`, `CsrfGuard`, `RateLimitGuard`,
 * `ManagedSchoolGuard`) and the assisted-mutation audit interceptor are
 * genuine, well-tested business logic — this migration keeps them as-is
 * rather than rewriting them. They are expressed against a tiny slice of
 * Nest's `ExecutionContext` / `Reflector` API, which is reproduced here on
 * plain `reflect-metadata`.
 *
 * Keeping these shapes also keeps the two guard specs and the interceptor
 * spec passing unchanged, which is exactly what the migration requires.
 */
import 'reflect-metadata';

/** Any class or function that metadata can be attached to. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Type<T = any> = new (...args: any[]) => T;

/** Handler/class pair metadata can be read from. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MetadataTarget = Function | Type<any>;

/** The HTTP half of an execution context. */
export interface HttpArgumentsHost {
  getRequest<T = unknown>(): T;
  getResponse<T = unknown>(): T;
}

/** Mirrors the subset of Nest's `ExecutionContext` the guards consume. */
export interface ExecutionContext {
  switchToHttp(): HttpArgumentsHost;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getHandler(): Function;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getClass(): Type<any>;
  getType(): string;
}

/** Mirrors Nest's `ArgumentsHost`. */
export interface ArgumentsHost {
  switchToHttp(): HttpArgumentsHost;
}

/** Contract implemented by every guard. */
export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

/** The deferred "rest of the pipeline" handed to an interceptor. */
export interface CallHandler<T = unknown> {
  handle(): T;
}

/** Contract implemented by the assisted-mutation audit interceptor. */
export interface NestInterceptor<T = unknown, R = T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): R | Promise<R>;
}

/** Contract implemented by pipes. */
export interface PipeTransform<T = unknown, R = unknown> {
  transform(value: T, metadata: { type: string; metatype?: unknown; data?: string }): R;
}

/** Contract implemented by exception filters. */
export interface ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void;
}

/**
 * Attaches metadata to a class or method — the `SetMetadata` decorator
 * factory. `@Roles(...)`, `@RateLimit(...)` and `@AssistedAllowWhenInactive()`
 * are all built on it, and their specs assert the metadata with
 * `Reflect.getMetadata`, so the storage mechanism must stay `reflect-metadata`.
 */
export function SetMetadata<K = string, V = unknown>(
  metadataKey: K,
  metadataValue: V,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
(target: any, key?: string | symbol, descriptor?: PropertyDescriptor) => any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (target: any, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(metadataKey, metadataValue, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(metadataKey, metadataValue, target);
    return target;
  };
}

/**
 * Reads metadata written by {@link SetMetadata}, with Nest's
 * "handler overrides class" precedence.
 */
export class Reflector {
  get<T>(metadataKey: unknown, target: MetadataTarget): T | undefined {
    return Reflect.getMetadata(metadataKey as string, target) as T | undefined;
  }

  /** Returns the first defined value across the targets, in order. */
  getAllAndOverride<T>(metadataKey: unknown, targets: MetadataTarget[]): T | undefined {
    for (const target of targets) {
      if (!target) {
        continue;
      }
      const value = Reflect.getMetadata(metadataKey as string, target) as T | undefined;
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /** Returns every defined value across the targets. */
  getAllAndMerge<T>(metadataKey: unknown, targets: MetadataTarget[]): T[] {
    const values: T[] = [];
    for (const target of targets) {
      if (!target) {
        continue;
      }
      const value = Reflect.getMetadata(metadataKey as string, target) as T | undefined;
      if (value !== undefined) {
        values.push(value);
      }
    }
    return values;
  }
}

/**
 * Builds an `ExecutionContext` over a plain request/response pair.
 *
 * The route-handler runtime uses this to run the existing guards untouched:
 * `handler` and `handlerClass` are the metadata carriers that `@Roles(...)`
 * and `@RateLimit(...)` were applied to.
 */
export function createExecutionContext(options: {
  request: unknown;
  response: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler?: Function;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlerClass?: Type<any>;
  type?: string;
}): ExecutionContext {
  const noop = function anonymousHandler() {};
  const handler = options.handler ?? noop;
  const handlerClass = options.handlerClass ?? (noop as unknown as Type);

  return {
    switchToHttp: () => ({
      getRequest: <T>() => options.request as T,
      getResponse: <T>() => options.response as T,
    }),
    getHandler: () => handler,
    getClass: () => handlerClass,
    getType: () => options.type ?? 'http',
  };
}
