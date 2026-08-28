/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_PROXY_ORIGIN || 'http://127.0.0.1:3001';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@school-bus-tracking/shared-types',
    '@school-bus-tracking/design-tokens',
    '@school-bus-tracking/config',
    '@school-bus-tracking/validation',
    '@school-bus-tracking/api-client',
  ],
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
