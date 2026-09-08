import './env';
import { ConfigService } from '../../src/server/framework';
import { getContainer } from '../../src/server/container';
import { bootstrapDatabase } from '../../src/server/database/bootstrap';
import { startTestServer, type RunningTestServer } from '../../src/server/http/test-server';
import { ALL_ROUTES } from './routes';

export interface TestApp {
  baseUrl: string;
  origin: string;
  close(): Promise<void>;
}

/**
 * Boots the real API over a real HTTP listener.
 *
 * Every endpoint definition is mounted with the production `api/v1` prefix,
 * and each request runs through the **same middleware chain the custom
 * server mounts in production** (`api-middleware-chain.ts`: CORS →
 * compression → security headers → cookie parsing → request-id) followed by
 * the same route runtime the Next handlers use — guard chain (CSRF → rate
 * limit → JWT → roles), the global validation settings, and the
 * success/error envelope. The end-to-end suites therefore exercise the exact
 * request pipeline production runs, CORS and security headers included.
 *
 * One deliberate difference from `server.js`, which does not affect the
 * behaviour under test: Next itself is not started — only `/api/v1/*` is
 * served (the file-system router would add nothing to these suites).
 */
export async function startTestApp(): Promise<TestApp> {
  const configService: ConfigService = getContainer().config();
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  // `server.js` connects PostgreSQL and hands the connection to the container
  // before serving traffic; the harness does the same so readiness probes and
  // the services that take the container connection (plan limits, assisted
  // management, imports) run against the migrated test database. Idempotent.
  // The pool is tracked so `close()` can release it — an open pool would keep
  // the test process alive after the suite ends.
  const bootstrappedSequelize = await bootstrapDatabase();

  const server: RunningTestServer = await startTestServer({
    routes: ALL_ROUTES,
    apiPrefix,
  });

  return {
    baseUrl: server.baseUrl,
    origin: server.origin,
    close: async () => {
      await server.close();
      // Release the container's pool (the specs close their own connection
      // separately). Safe to repeat — `sequelize.close()` is idempotent.
      if (bootstrappedSequelize && containerSequelizeWasOpenedByHarness(bootstrappedSequelize)) {
        await bootstrappedSequelize.close().catch(() => undefined);
      }
    },
  };
}

/**
 * Guards the pool close: when several harness instances share one process
 * (or a stubbed bootstrap handed us `null`), only a connection this harness
 * actually opened may be closed. `bootstrapDatabase()` returns the container
 * singleton, which is exactly what the harness opened in its own process.
 */
function containerSequelizeWasOpenedByHarness(
  sequelize: NonNullable<Awaited<ReturnType<typeof bootstrapDatabase>>>,
): boolean {
  return Boolean(sequelize && 'close' in sequelize);
}
