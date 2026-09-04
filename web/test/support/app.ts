import './env';
import { INestApplication, ValidationPipe } from '../../src/server/framework';
import { ConfigService } from '../../src/server/framework';
import type { AddressInfo } from 'net';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor';
import {
  buildCorsOptions,
  createSecurityHeadersMiddleware,
  resolveCorsPolicy,
} from '../../src/common/security';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  close(): Promise<void>;
}

/**
 * Boots the real Nest application over a real HTTP listener.
 *
 * The bootstrap mirrors `src/main.ts` (CORS policy, security headers, cookie
 * parser, global prefix, validation pipe, exception filter, transform
 * interceptor) so the end-to-end suites exercise the same request pipeline
 * production runs — guards, tenant scoping, CSRF and all.
 *
 * The logging interceptor is intentionally omitted to keep the test output
 * readable; it has no effect on behaviour.
 */
export async function startTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  const configService = app.get(ConfigService);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');

  const corsPolicy = resolveCorsPolicy({
    isProduction: configService.get<boolean>('security.isProduction', false),
    corsOrigins: configService.get<string[]>('security.corsOrigins', []),
    credentials: configService.get<boolean>('security.corsCredentials', true),
  });
  app.enableCors(buildCorsOptions(corsPolicy));

  app.use(
    createSecurityHeadersMiddleware({
      enabled: configService.get<boolean>('security.headers.enabled', true),
      isProduction: configService.get<boolean>('security.isProduction', false),
      hstsMaxAge: configService.get<number>('security.headers.hstsMaxAge', 15552000),
      hstsIncludeSubDomains: true,
      hstsPreload: false,
      cspEnabled: configService.get<boolean>('security.headers.cspEnabled', true),
      frameAncestors: configService.get<string>('security.headers.frameAncestors', "'none'"),
      referrerPolicy: configService.get<string>(
        'security.headers.referrerPolicy',
        'strict-origin-when-cross-origin',
      ),
      permissionsPolicy: configService.get<string>('security.headers.permissionsPolicy', ''),
    }),
  );

  app.use(cookieParser());
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  await app.init();
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/${apiPrefix}`;

  return {
    app,
    baseUrl,
    close: async () => {
      await app.close();
    },
  };
}
