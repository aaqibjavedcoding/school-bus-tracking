import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// `cookie-parser` is a CommonJS module without an `__esModule` marker, so the
// default-import sugar would emit `require(...).default` (undefined) under the
// API's CommonJS tsc build. A namespace import keeps the runtime call correct
// while remaining type-safe.
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import {
  buildCorsOptions,
  createSecurityHeadersMiddleware,
  resolveCorsPolicy,
} from './common/security';
import { StructuredLoggingInterceptor } from './common/interceptors/structured-logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { createCompressionMiddleware } from './common/middleware/compression.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { models } from './database/models';
import { LiveTrackingIoAdapter } from './modules/live-tracking/live-tracking.ws-adapter';

function assertSequelizeModelsInitialized(): void {
  const uninitialized = models.filter((model) => !model.isInitialized).map((model) => model.name);

  if (uninitialized.length > 0) {
    throw new Error(
      `Database models were not initialized (${uninitialized.join(
        ', ',
      )}). Start the API with database connectivity enabled; DB_AUTO_CONNECT=false is only for stubbed tests/smoke scripts.`,
    );
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3001);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');

  // Explicit, allowlisted CORS. `resolveCorsPolicy` throws in production when
  // the allowlist is missing or wildcarded, so a misconfigured deployment
  // fails to boot instead of serving a wide-open API.
  const corsPolicy = resolveCorsPolicy({
    isProduction: configService.get<boolean>('security.isProduction', false),
    corsOrigins: configService.get<string[]>('security.corsOrigins', []),
    credentials: configService.get<boolean>('security.corsCredentials', true),
  });
  app.enableCors(buildCorsOptions(corsPolicy));

  // gzip/deflate response compression. Content-negotiated via
  // Accept-Encoding: WebSocket upgrade requests and already-compressed
  // bodies (e.g. XLSX/CSV exports) are passed through untouched. Mounted
  // first so every JSON response over the size threshold is compressed.
  app.use(
    createCompressionMiddleware({
      enabled: configService.get<boolean>('app.compression.enabled', true),
      threshold: configService.get<number>('app.compression.thresholdBytes', 1024),
    }),
  );

  // Security headers (Helmet + Permissions-Policy + conditional HSTS).
  app.use(
    createSecurityHeadersMiddleware({
      enabled: configService.get<boolean>('security.headers.enabled', true),
      isProduction: configService.get<boolean>('security.isProduction', false),
      hstsMaxAge: configService.get<number>('security.headers.hstsMaxAge', 15552000),
      hstsIncludeSubDomains: configService.get<boolean>(
        'security.headers.hstsIncludeSubDomains',
        true,
      ),
      hstsPreload: configService.get<boolean>('security.headers.hstsPreload', false),
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

  // Request/correlation ID: accepts client-supplied x-request-id or generates one.
  app.use(new RequestIdMiddleware().use.bind(new RequestIdMiddleware()));

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new StructuredLoggingInterceptor(), new TransformInterceptor());

  // The live-tracking Socket.IO server inherits the application's CORS
  // policy and packet caps through the custom adapter (see
  // `live-tracking.ws-adapter.ts`).
  app.useWebSocketAdapter(new LiveTrackingIoAdapter(app));

  // Initialize providers before listening, then fail fast if any Sequelize
  // model class is still detached. This turns the previous login-time
  // `Model not initialized: User.unscoped()` 500 into a clear startup error.
  await app.init();
  assertSequelizeModelsInitialized();

  await app.listen(port);
  logger.log(`API Application is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`Health endpoint available at: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
