/**
 * Bootstrap shim for the smoke scripts.
 *
 * The scripts used to call `NestFactory.create(AppModule)` and then reach into
 * the DI container with `app.get(SomeService)` to swap repositories for
 * in-memory stubs. There is no DI container any more, so this exposes the same
 * three things over the composition root and the endpoint definitions:
 *
 * - `app.get(ServiceClass)` — the singleton from `container.ts`, looked up by
 *   constructor, so the existing `patchService(app.get(X), stubs)` calls keep
 *   working untouched.
 * - `app.listen(0)` / `app.getHttpServer()` — a real HTTP listener serving
 *   every route through the production route runtime.
 * - `app.close()`.
 *
 * The scripts are manual diagnostics rather than part of the test suite, so
 * this deliberately favours keeping their bodies unchanged over elegance.
 */
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { getContainer } from '../../../src/server/container';
import { startTestServer, type RunningTestServer } from '../../../src/server/http/test-server';
import { ALL_ROUTES } from '../../../test/support/routes';

type Ctor<T> = abstract new (...args: never[]) => T;

/** Container accessors, indexed by the class each one builds. */
function serviceIndex(): Map<unknown, () => unknown> {
  const container = getContainer() as unknown as Record<string, unknown>;
  const index = new Map<unknown, () => unknown>();

  for (const key of Object.keys(container)) {
    const accessor = container[key];
    if (typeof accessor !== 'function') {
      continue;
    }
    try {
      const instance = (accessor as () => unknown)();
      if (instance && typeof instance === 'object') {
        index.set((instance as object).constructor, accessor as () => unknown);
      }
    } catch {
      // A singleton that cannot be constructed without a database is simply
      // not resolvable here; the scripts that need it stub it beforehand.
    }
  }
  return index;
}

export interface SmokeApp {
  get<T>(token: Ctor<T>): T;
  listen(port?: number): Promise<void>;
  getHttpServer(): Server & { address(): AddressInfo | string | null };
  close(): Promise<void>;
  baseUrl: string;
}

export async function createSmokeApp(): Promise<SmokeApp> {
  const index = serviceIndex();
  let running: RunningTestServer | undefined;

  const app: SmokeApp = {
    get<T>(token: Ctor<T>): T {
      const accessor = index.get(token);
      if (!accessor) {
        throw new Error(
          `No container binding for ${(token as unknown as { name?: string }).name ?? 'service'}.`,
        );
      }
      return accessor() as T;
    },

    async listen(): Promise<void> {
      running = await startTestServer({ routes: ALL_ROUTES });
      app.baseUrl = running.baseUrl;
    },

    /**
     * Nest returned the underlying server before `listen()`, and some scripts
     * capture it first and read `.address()` afterwards. A lazy proxy keeps
     * that order working: the reference is stable, and every call is
     * forwarded to the real server once it exists.
     */
    getHttpServer() {
      const target = createServer();
      return new Proxy(target, {
        get: (_fallback, property) => {
          const server = running?.server;
          if (!server) {
            throw new Error('Call listen() before using the HTTP server.');
          }
          const value = Reflect.get(server, property);
          return typeof value === 'function' ? value.bind(server) : value;
        },
      }) as Server & { address(): AddressInfo | string | null };
    },

    async close(): Promise<void> {
      await running?.close();
    },

    baseUrl: '',
  };

  return app;
}
