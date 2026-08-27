/**
 * Shared Configuration Defaults & Constants (Phase 1)
 */

export const APP_CONFIG = {
  appName: 'School Bus Tracking SaaS',
  shortName: 'SBT',
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
