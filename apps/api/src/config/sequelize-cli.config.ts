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
dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });

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
