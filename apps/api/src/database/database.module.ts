import { existsSync } from 'fs';
import { resolve } from 'path';
import { DynamicModule, Logger, Module, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InjectConnection, SequelizeModule } from '@nestjs/sequelize';
import { config as loadDotenv } from 'dotenv';
import { Sequelize } from 'sequelize-typescript';
import { databaseProviders } from './database.providers';
import { models } from './models';

/**
 * `DatabaseModule.forRoot()` runs while `AppModule` is being evaluated — before
 * Nest bootstraps `ConfigModule` and before it loads `.env` files. Without an
 * early load here, a developer who only sets database settings in `.env` can
 * boot the API with incomplete connection options.
 *
 * Existing process env always wins (`override: false`) so CI/shell values are
 * respected; we only fill gaps from the conventional env files.
 */
function loadEnvFilesEarly(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    // nest start cwd is typically `apps/api`; compiled code lives in `dist/database`.
    resolve(__dirname, '../../.env'),
    resolve(__dirname, '../../.env.local'),
    // monorepo root when the process was started from the workspace root.
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../../.env.local'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
    }
  }
}

loadEnvFilesEarly();

/**
 * Returns true only for test/smoke bootstraps that intentionally replace every
 * repository with in-memory stubs. A normal API process must never honor
 * `DB_AUTO_CONNECT=false`: doing so starts Nest without a Sequelize instance,
 * leaving static model methods such as `User.unscoped()` uninitialized until a
 * request crashes with `Model not initialized`.
 */
function isNoDatabaseBootstrapAllowed(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  if (process.env.DB_ALLOW_NO_CONNECT === 'true') {
    return true;
  }

  return process.argv.some(
    (arg) => /[\\/]scripts[\\/]smoke[\\/]/.test(arg) || /\.(spec|test)\.[cm]?[tj]sx?$/.test(arg),
  );
}

/**
 * `DB_AUTO_CONNECT=false` is a dangerous footgun for the real API because this
 * project injects Sequelize model classes behind custom tokens. Without a
 * connection, those classes are never initialized. Keep the opt-out for tests
 * and smoke scripts, but ignore it for normal `start` / `start:dev` /
 * `start:prod` bootstraps so login cannot fail at runtime.
 */
function shouldAutoConnectDatabase(logger: Logger): boolean {
  const disabled = process.env.DB_AUTO_CONNECT?.trim().toLowerCase() === 'false';

  if (!disabled) {
    return true;
  }

  if (isNoDatabaseBootstrapAllowed()) {
    return false;
  }

  logger.warn(
    'Ignoring DB_AUTO_CONNECT=false for this API process. Database connectivity is required so Sequelize models are initialized. Use DB_ALLOW_NO_CONNECT=true only in stubbed test/smoke bootstraps.',
  );
  return true;
}

/**
 * Final safety net: if the Sequelize connection came up without every domain
 * model registered (for example when `autoLoadModels` only saw an empty
 * `forFeature` registry), attach them before the app starts accepting traffic.
 *
 * Registered only when auto-connect is enabled so unit/smoke tests that run
 * with `DB_AUTO_CONNECT=false` do not need a real Sequelize provider.
 */
class SequelizeModelInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger('SequelizeModelInitService');

  constructor(
    @Optional()
    @InjectConnection()
    private readonly sequelize?: Sequelize,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.sequelize) {
      return;
    }

    const pending = models.filter((model) => model && !model.isInitialized);
    if (pending.length === 0) {
      return;
    }

    this.logger.warn(
      `Registering ${pending.length} Sequelize model(s) that were not initialized during connect: ${pending
        .map((model) => model.name)
        .join(', ')}`,
    );
    this.sequelize.addModels(pending);
  }
}

@Module({
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule {
  static forRoot(): DynamicModule {
    // A running API needs an initialized Sequelize instance before any model
    // method (for example `User.unscoped()` during login) can be called. Keep
    // the opt-out only for unit/smoke tests that replace repositories with
    // stubs; normal development and production starts must always connect.
    const logger = new Logger('DatabaseModule');
    const isDbAutoConnect = shouldAutoConnectDatabase(logger);

    if (!isDbAutoConnect) {
      logger.log('Database auto-connect is disabled for this process.');
      return {
        module: DatabaseModule,
        providers: [...databaseProviders],
        exports: [...databaseProviders],
      };
    }

    // `SequelizeModule.forFeature(models)` populates Nest's
    // `EntitiesMetadataStorage`. With `autoLoadModels: true`, @nestjs/sequelize
    // reads that registry inside `createConnectionFactory` and calls
    // `sequelize.addModels(...)` — which is what flips
    // `Model.isInitialized` to true. Passing `models` in forRoot options is
    // kept as a belt-and-suspenders path (sequelize-typescript also registers
    // them in its constructor).
    //
    // Feature modules intentionally inject model classes behind custom tokens
    // (`useValue: User`) instead of `@InjectModel`, so without this explicit
    // forFeature registration Nest would connect to Postgres and still leave
    // every model uninitialized — exactly the admin-login 500.
    const featureModels = SequelizeModule.forFeature([...models]);

    return {
      module: DatabaseModule,
      imports: [
        SequelizeModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            dialect: 'postgres' as const,
            host: configService.get<string>('database.host', 'localhost'),
            port: configService.get<number>('database.port', 5432),
            username: configService.get<string>('database.username', 'postgres'),
            password: configService.get<string>('database.password', 'postgres'),
            database: configService.get<string>('database.name', 'school_bus_tracking'),
            // Domain models are declared once in `database/models/index.ts`.
            models: [...models],
            // Pulls models registered via `SequelizeModule.forFeature` above.
            autoLoadModels: true,
            // Schema changes come from migrations only — never from the ORM.
            synchronize: false,
            sync: { force: false, alter: false },
            logging: configService.get<boolean>('database.logging', false)
              ? (msg: string) => console.log(msg)
              : false,
            pool: {
              max: configService.get<number>('database.pool.max', 20),
              min: configService.get<number>('database.pool.min', 2),
              acquire: configService.get<number>('database.pool.acquire', 30000),
              idle: configService.get<number>('database.pool.idle', 10000),
            },
            dialectOptions: configService.get<boolean>('database.ssl', false)
              ? { ssl: { require: true, rejectUnauthorized: false } }
              : {},
            retryAttempts: 5,
            retryDelay: 3000,
          }),
        }),
        featureModels,
      ],
      providers: [...databaseProviders, SequelizeModelInitService],
      exports: [SequelizeModule, ...databaseProviders],
    };
  }
}
