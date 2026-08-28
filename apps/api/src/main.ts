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
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LiveTrackingIoAdapter } from './modules/live-tracking/live-tracking.ws-adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3001);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');
  const corsOrigin = configService.get<string>('app.corsOrigin', '*');

  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.use(cookieParser());
  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  // The live-tracking Socket.IO server inherits the application's CORS
  // policy and packet caps through the custom adapter (see
  // `live-tracking.ws-adapter.ts`).
  app.useWebSocketAdapter(new LiveTrackingIoAdapter(app));

  await app.listen(port);
  logger.log(`API Application is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`Health endpoint available at: http://localhost:${port}/${apiPrefix}/health`);
}

bootstrap();
