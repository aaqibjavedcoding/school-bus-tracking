/**
 * Database bootstrap — the plain-TypeScript replacement for `DatabaseModule`.
 *
 * Responsibilities carried over verbatim from the old Nest dynamic module:
 *
 * - load `.env` / `.env.local` early so a developer who configures only the
 *   env files still gets complete connection options;
 * - decide whether this process may start *without* a database
 *   (`DB_AUTO_CONNECT=false` is honoured only for tests and smoke scripts —
 *   a real server always connects, otherwise static model methods such as
 *   `User.unscoped()` would throw `Model not initialized` at login);
 * - construct the Sequelize instance with the same options and register every
 *   domain model, so `Model.isInitialized` is true before traffic is served.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import { Sequelize } from 'sequelize-typescript';
import { ConfigService, Logger } from '../framework';
import { models } from './models';

/**
 * Existing process env always wins (`override: false`) so CI/shell values are
 * respected; we only fill gaps from the conventional env files.
 */
export function loadEnvFilesEarly(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../../.env.local'),
    resolve(__dirname, '../../../../.env'),
    resolve(__dirname, '../../../../.env.local'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path, override: false });
    }
  }
}

/**
 * Returns true only for test/smoke bootstraps that intentionally replace every
 * repository with in-memory stubs. A normal server process must never honor
 * `DB_AUTO_CONNECT=false`.
 */
export function isNoDatabaseBootstrapAllowed(): boolean {
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
 * `DB_AUTO_CONNECT=false` is a dangerous footgun because this project injects
 * Sequelize model classes directly. Keep the opt-out for tests and smoke
 * scripts, but ignore it for normal server bootstraps so login cannot fail at
 * runtime.
 */
export function shouldAutoConnectDatabase(logger = new Logger('Database')): boolean {
  const disabled = process.env.DB_AUTO_CONNECT?.trim().toLowerCase() === 'false';

  if (!disabled) {
    return true;
  }

  if (isNoDatabaseBootstrapAllowed()) {
    return false;
  }

  logger.warn(
    'Ignoring DB_AUTO_CONNECT=false for this server process. Database connectivity is required so Sequelize models are initialized. Use DB_ALLOW_NO_CONNECT=true only in stubbed test/smoke bootstraps.',
  );
  return true;
}

/** Fails fast when any Sequelize model class is still detached. */
export function assertSequelizeModelsInitialized(): void {
  const uninitialized = models.filter((model) => !model.isInitialized).map((model) => model.name);

  if (uninitialized.length > 0) {
    throw new Error(
      `Database models were not initialized (${uninitialized.join(
        ', ',
      )}). Start the server with database connectivity enabled; DB_AUTO_CONNECT=false is only for stubbed tests/smoke scripts.`,
    );
  }
}

/**
 * Creates the Sequelize connection and attaches every domain model.
 *
 * Mirrors the options the old `SequelizeModule.forRootAsync` factory built.
 * Schema changes come from migrations only — `synchronize` is always false.
 */
export function createSequelize(configService: ConfigService): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: configService.get<string>('database.host', 'localhost'),
    port: configService.get<number>('database.port', 5432),
    username: configService.get<string>('database.username', 'postgres'),
    password: configService.get<string>('database.password', 'postgres'),
    database: configService.get<string>('database.name', 'school_bus_tracking'),
    models: [...models],
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
  });
}

loadEnvFilesEarly();

/**
 * Connects the database (when this process should) and hands the instance to
 * the container. Idempotent: repeated calls reuse the existing connection,
 * which matters because Next may evaluate the instrumentation hook more than
 * once during development hot-reload.
 */
export async function bootstrapDatabase(): Promise<Sequelize | null> {
  const logger = new Logger('Database');
  const { getContainer } = await import('../container');
  const appContainer = getContainer();

  if (appContainer.sequelize) {
    return appContainer.sequelize;
  }

  if (!shouldAutoConnectDatabase(logger)) {
    logger.log('Database auto-connect is disabled for this process.');
    return null;
  }

  const sequelize = createSequelize(appContainer.config());
  await sequelize.authenticate();

  // Belt and braces: `new Sequelize({ models })` registers them, but a model
  // added later (or a hot-reloaded duplicate registry) would otherwise stay
  // detached and only fail at query time.
  const pending = models.filter((model) => model && !model.isInitialized);
  if (pending.length > 0) {
    logger.warn(
      `Registering ${pending.length} Sequelize model(s) that were not initialized during connect: ${pending
        .map((model) => model.name)
        .join(', ')}`,
    );
    sequelize.addModels(pending);
  }

  assertSequelizeModelsInitialized();

  appContainer.sequelize = sequelize;
  logger.log('Database connection established and models initialized.');
  return sequelize;
}
