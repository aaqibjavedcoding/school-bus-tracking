import './env';
import { ConfigService } from '../../src/server/framework';
import { getContainer } from '../../src/server/container';
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
 * and each request runs through the same route runtime the Next handlers use
 * — guard chain (CSRF → rate limit → JWT → roles), the global validation
 * settings, and the success/error envelope. The end-to-end suites therefore
 * exercise the same request pipeline production runs, tenant scoping and CSRF
 * included.
 *
 * Two deliberate differences from `server.js`, neither of which affects the
 * behaviour under test:
 *
 * - Next itself is not started; only `/api/v1/*` is served.
 * - The CORS and security-header middleware are omitted. They are pure
 *   response decoration applied by the custom server and are covered by their
 *   own unit suites; the security e2e spec asserts the headers the *handlers*
 *   emit.
 */
export async function startTestApp(): Promise<TestApp> {
  const configService: ConfigService = getContainer().config();
  const apiPrefix = configService.get<string>('app.apiPrefix') ?? 'api/v1';

  const server: RunningTestServer = await startTestServer({
    routes: ALL_ROUTES,
    apiPrefix,
  });

  return {
    baseUrl: server.baseUrl,
    origin: server.origin,
    close: () => server.close(),
  };
}
