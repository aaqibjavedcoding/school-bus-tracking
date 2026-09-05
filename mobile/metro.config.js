const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace root. `mobile/` sits directly inside the
// repository root, so the monorepo root is exactly one level up. (It used to
// be `apps/mobile`, two levels down — with `'../..'` Metro looked for
// `node_modules` *above* the repository and `expo-router` could not resolve.)
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Hierarchical lookup stays ENABLED (this is the default, and what Expo's
//    monorepo guidance uses). Disabling it makes Metro search *only* the two
//    directories above, so any package npm nested inside another package's own
//    `node_modules` becomes invisible — e.g. `is-arrayish` under
//    `simple-swizzle/node_modules`, which fails the Android bundle with
//    "Unable to resolve module is-arrayish".

module.exports = config;
