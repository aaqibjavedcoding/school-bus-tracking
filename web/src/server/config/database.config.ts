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

export default registerAs('database', () => ({
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  name: process.env.DB_NAME || 'school_bus_tracking',
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: process.env.DB_SSL === 'true',
  logging: process.env.DB_LOGGING === 'true',
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
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
}));
