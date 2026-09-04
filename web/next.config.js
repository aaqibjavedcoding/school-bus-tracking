/** @type {import('next').NextConfig} */
const { buildSecurityHeaders } = require('./security-headers');

const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@school-bus-tracking/shared-types',
    '@school-bus-tracking/design-tokens',
    '@school-bus-tracking/config',
    '@school-bus-tracking/validation',
    '@school-bus-tracking/api-client',
  ],
  poweredByHeader: false,
  /**
   * Keep the whole backend out of the webpack bundle.
   *
   * `src/server` is decorator-heavy Sequelize code with genuinely circular
   * model imports (`@HasMany` / `@BelongsTo` point at each other). Node's
   * CommonJS loader tolerates those cycles; webpack's ESM interop hoists the
   * bindings and the models hit a temporal-dead-zone `ReferenceError` at
   * import time. So the server tree is compiled separately to CommonJS by
   * `npm run build:server` (see `tsconfig.build.json`) and required at
   * runtime, which also guarantees a single Sequelize model registry per
   * process — the same arrangement the tests and the custom server use.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      const serverSrc = path.join(__dirname, 'src', 'server');
      const serverDist = path.join(__dirname, 'dist');
      const previous = config.externals ?? [];
      config.externals = [
        ({ context, request }, callback) => {
          if (request && (request.startsWith('.') || request.startsWith('/'))) {
            const resolved = path.resolve(context, request);
            if (resolved.startsWith(serverSrc)) {
              // Point at the compiled output rather than the .ts source.
              const compiled = path.join(serverDist, path.relative(serverSrc, resolved));
              return callback(null, `commonjs ${compiled}`);
            }
          }
          return callback();
        },
        ...(Array.isArray(previous) ? previous : [previous]),
      ];
    }
    return config;
  },
  // The gateway wiring in `instrumentation.ts` must run on server start.
  experimental: {
    instrumentationHook: true,
    /**
     * The API route handlers pull in native and CommonJS-only packages.
     * Bundling them breaks Sequelize's model registry and firebase-admin's
     * lazy requires, so they stay external and are required at runtime.
     */
    serverComponentsExternalPackages: [
      'sequelize',
      'sequelize-typescript',
      'pg',
      'pg-hstore',
      'firebase-admin',
      'exceljs',
      'bcryptjs',
      'socket.io',
    ],
  },
  /**
   * Security headers for every document/asset response. See
   * `security-headers.js` for the reasoning behind each directive.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: buildSecurityHeaders({
          isProduction,
          extraConnectSrc: (process.env.CSP_EXTRA_CONNECT_SRC || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
          extraImgSrc: (process.env.CSP_EXTRA_IMG_SRC || '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        }),
      },
    ];
  },
};

module.exports = nextConfig;
