import dotenv from 'dotenv';
import type { Options } from 'sequelize';

/**
 * Sequelize CLI / migration runner configuration.
 *
 * The CLI and migration/seed scripts do not boot the Nest application, so the
 * `ConfigModule` and `src/config/database.config.ts` are unavailable here.
 * Environment variables are loaded explicitly from the API workspace `.env`
 * files to keep the CLI and the application on identical connection settings.
 *
 * This file is loaded by sequelize-cli through a dynamic ESM `import()`
 * (Node 22 strips TypeScript types natively), therefore it uses an ESM
 * default export. Migration and seeder files use CommonJS-compatible named
 * exports because Umzug loads them via `require()`.
 *
 * NOTE: Database structure is managed exclusively through migrations
 * (`npm run db:migrate`). `sequelize.sync()` must never be used.
 */
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

/**
 * Mirrors `assertSafeProductionDatabaseConfig` from `database.config.ts`
 * (kept inline because this ESM file cannot import the compiled CommonJS
 * app config). Migrations and seeds in production must fail loudly instead
 * of silently using the insecure development defaults.
 */
function assertSafeProductionCliDatabaseConfig(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const problems: string[] = [];
  for (const name of ['DB_HOST', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'] as const) {
    const value = process.env[name];
    if (!value || value.trim().length === 0) {
      problems.push(
        `${name} is not set. Production refuses the insecure development default; configure it explicitly.`,
      );
    }
  }
  if (process.env.DB_SSL !== 'true') {
    problems.push(
      'DB_SSL must be "true" in production so credentials travel over TLS. Set DB_SSL=true (and provide the provider CA if required).',
    );
  }
  if (problems.length > 0) {
    throw new Error(
      [
        'Unsafe production database configuration — refusing to run migrations/seeds.',
        ...problems.map((problem) => `  - ${problem}`),
        'Development defaults are never applied when NODE_ENV=production.',
      ].join('\n'),
    );
  }
}

assertSafeProductionCliDatabaseConfig();

const baseConfig: Options = {
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'school_bus_tracking',
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  // Use snake_case database identifiers (e.g. createdAt -> created_at).
  define: {
    underscored: true,
  },
  // Never let the CLI synchronize models — schema changes come from migrations.
  sync: {
    force: false,
    alter: false,
  },
  logging: false,
};

const sequelizeConfig: Record<'development' | 'test' | 'production', Options> = {
  development: baseConfig,
  test: {
    ...baseConfig,
    database: process.env.DB_NAME_TEST || 'school_bus_tracking_test',
    logging: false,
  },
  production: {
    ...baseConfig,
    // SSL is required for managed production databases when DB_SSL=true.
    ...(process.env.DB_SSL === 'true'
      ? {
          dialectOptions: {
            ssl: {
              require: true,
              rejectUnauthorized: false,
            },
          },
        }
      : {}),
    logging: false,
  },
};

export default sequelizeConfig;
