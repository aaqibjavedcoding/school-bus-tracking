import { registerAs } from '../framework';

function isNoDatabaseBootstrapAllowed(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.DB_ALLOW_NO_CONNECT === 'true' ||
    process.argv.some(
      (arg) => /[\\/]scripts[\\/]smoke[\\/]/.test(arg) || /\.(spec|test)\.[cm]?[tj]sx?$/.test(arg),
    )
  );
}

/**
 * Fails fast when a production process would silently boot with insecure or
 * default database configuration.
 *
 * The dev defaults (`postgres`/`postgres` on `localhost`, SSL off) are only
 * acceptable for local development. In production every connection setting
 * must be explicit and TLS must be enabled, so a missing variable aborts the
 * process with one clear, actionable error instead of quietly connecting to
 * the wrong database or sending credentials unencrypted.
 *
 * Test/smoke bootstraps never hit this guard: they run with
 * `NODE_ENV !== 'production'`.
 */
export function assertSafeProductionDatabaseConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const problems: string[] = [];

  for (const name of ['DB_HOST', 'DB_NAME', 'DB_USERNAME', 'DB_PASSWORD'] as const) {
    const value = env[name];
    if (!value || value.trim().length === 0) {
      problems.push(
        `${name} is not set. Production refuses the insecure development default; configure it explicitly.`,
      );
    }
  }

  if (env.DB_SSL !== 'true') {
    problems.push(
      'DB_SSL must be "true" in production so credentials travel over TLS. Set DB_SSL=true (and provide the provider CA if required).',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      [
        'Unsafe production database configuration — refusing to start.',
        ...problems.map((problem) => `  - ${problem}`),
        'Development defaults are never applied when NODE_ENV=production.',
      ].join('\n'),
    );
  }
}

export default registerAs('database', () => {
  assertSafeProductionDatabaseConfig();

  return {
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'school_bus_tracking',
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
    logging: process.env.DB_LOGGING === 'true',
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '30', 10),
      min: parseInt(process.env.DB_POOL_MIN || '5', 10),
      acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000', 10),
      idle: parseInt(process.env.DB_POOL_IDLE || '10000', 10),
    },
    // Informational flag for diagnostics. `DatabaseModule` uses the same guard:
    // a real API bootstrap ignores DB_AUTO_CONNECT=false unless no-DB mode is
    // explicitly allowed for tests/smoke, because otherwise Sequelize model
    // classes stay uninitialized and login fails at runtime.
    autoConnect:
      process.env.DB_AUTO_CONNECT?.trim().toLowerCase() !== 'false' ||
      !isNoDatabaseBootstrapAllowed(),
  };
});
