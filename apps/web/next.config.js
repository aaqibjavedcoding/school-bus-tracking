/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@school-bus-tracking/shared-types',
    '@school-bus-tracking/design-tokens',
    '@school-bus-tracking/config',
    '@school-bus-tracking/validation',
    '@school-bus-tracking/api-client',
  ],
};

module.exports = nextConfig;
