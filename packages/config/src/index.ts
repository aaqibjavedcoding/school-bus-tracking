/**
 * Shared Configuration Defaults & Constants (Phase 1)
 */

/**
 * The product's own name lives here and nowhere else in code: the web console
 * reads `appName` for its page titles and brand lockups instead of repeating a
 * literal per screen. (The mobile app reads its copy from `src/lib/i18n.*`,
 * which is the dictionary of record for every user-visible mobile string; the
 * OS-level app name is declared once in `mobile/app.json`.)
 */
export const APP_CONFIG = {
  appName: 'KidBus',
  shortName: 'KB',
  version: '0.1.0',
  defaultApiPort: 3001,
  defaultWebPort: 3000,
  defaultMobilePort: 8081,
  apiPrefix: 'api/v1',
} as const;

export const ENVIRONMENTS = {
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
  TEST: 'test',
} as const;

export type Environment = (typeof ENVIRONMENTS)[keyof typeof ENVIRONMENTS];

export interface AppConfig {
  appName: string;
  environment: Environment;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
}

export interface DatabaseConfig {
  dialect: 'postgres';
  host: string;
  port: number;
  name: string;
  username: string;
  password?: string;
  ssl: boolean;
  pool: {
    max: number;
    min: number;
    acquire: number;
    idle: number;
  };
}

export const DEFAULT_DB_CONFIG: DatabaseConfig = {
  dialect: 'postgres',
  host: 'localhost',
  port: 5432,
  name: 'school_bus_tracking',
  username: 'postgres',
  ssl: false,
  pool: {
    max: 20,
    min: 2,
    acquire: 30000,
    idle: 10000,
  },
};
