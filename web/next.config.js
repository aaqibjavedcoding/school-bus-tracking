/** @type {import('next').NextConfig} */
const { buildSecurityHeaders } = require('./security-headers');

const apiOrigin = process.env.API_PROXY_ORIGIN || 'http://127.0.0.1:3001';
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
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${apiOrigin}/socket.io/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
