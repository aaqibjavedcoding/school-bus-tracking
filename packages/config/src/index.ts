/**
 * Shared Configuration Defaults & Constants (Phase 1)
 *
 * `appName` / `shortName` are the **single brand source for the web console**:
 * the product is branded **KidBus**, and every web surface renders the name
 * from here rather than repeating the literal —
 *
 * - the document `title` (`web/src/app/layout.tsx`);
 * - the login heading and brand mark (`web/src/app/login/page.tsx`);
 * - the AppShell sidebar heading and brand mark (`AppShell.tsx`).
 *
 * The mobile app deliberately keeps its **own** copy of the same two strings in
 * the localisation dictionaries (`login.brandName` / `login.brandMark`, which
 * `LOCALE_INVARIANT_KEYS` marks as intentionally identical in en/hi/mr, and the
 * foreground-service notification title `gps.service.title`). That is not
 * duplication by accident: `mobile/src/lib/i18n.en.ts` is a documented
 * data-only module — "no imports, no logic, no React" — so it cannot pull the
 * value from here. The mobile *screens* still read one source (the i18n key),
 * never a hardcoded literal.
 *
 * Only the *display* name lives here. The identity the platform is registered
 * under is deliberately **not** rebranded and must not be derived from these
 * two fields: the Android package / iOS bundle identifier
 * (`com.schoolbustracking.app`), the `schoolbustracking` URL scheme, the EAS
 * `projectId`, `google-services.json` and the Firebase project all stay as
 * they are — renaming them would break push delivery and existing installs.
 */
export const APP_CONFIG = {
  /** The product's display name. */
  appName: 'KidBus',
  /** The compact mark shown in the brand chip beside {@link APP_CONFIG.appName}. */
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
