const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

// Find the project and workspace root. `mobile/` sits directly inside the
// repository root, so the monorepo root is exactly one level up. (It used to
// be `apps/mobile`, two levels down — with `'../..'` Metro looked for
// `node_modules` *above* the repository and `expo-router` could not resolve.)
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const projectNodeModules = path.resolve(projectRoot, 'node_modules');
const monorepoNodeModules = path.resolve(monorepoRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [monorepoRoot];

// 2. Fallback lookup paths for imports nothing else can satisfy — notably
//    `react-native`, which npm nests in mobile/node_modules because it is only
//    a mobile dependency, but which every hoisted Expo package imports.
//
//    These are a FALLBACK, not a priority: metro-resolver builds the
//    hierarchical candidates from the importing file first and only then
//    appends `nodeModulesPaths` (`metro-resolver/src/resolve.js`:
//    `nodeModulesPaths.push(...context.nodeModulesPaths)`). Listing
//    mobile/node_modules here therefore does *not* make it win over
//    <root>/node_modules — which is exactly why step 4 below is needed.
config.resolver.nodeModulesPaths = [projectNodeModules, monorepoNodeModules];

// 3. Hierarchical lookup stays ENABLED (this is the default, and what Expo's
//    monorepo guidance uses). Disabling it makes Metro search *only* the two
//    directories above, so any package npm nested inside another package's own
//    `node_modules` becomes invisible — e.g. `is-arrayish` under
//    `simple-swizzle/node_modules`, which fails the Android bundle with
//    "Unable to resolve module is-arrayish".

// ---------------------------------------------------------------------------
// 4. Pin a single copy of React and of the packages that own its internals.
//
//    This monorepo installs two Reacts. The web app pins react/react-dom
//    18.3.1 (Next 14), and npm hoists those to <root>/node_modules. The mobile
//    app needs react/react-dom 19.1.0 (what react-native 0.81 peers on), so
//    npm nests that copy in mobile/node_modules.
//
//    With hierarchical lookup running first, every bare `require('react')`
//    issued from a package hoisted to the monorepo root — `expo`,
//    `expo-router`, `expo-keep-awake`, … — lands on <root>/node_modules/react
//    (18.3.1), while mobile/app/** and react-native land on
//    mobile/node_modules/react (19.1.0). Two Reacts ship in one bundle, the
//    renderer installs its dispatcher on one of them, and the first hook
//    called from the other throws at startup:
//
//      ERROR  [TypeError: Cannot read property 'useId' of null]
//        useId (node_modules/react/cjs/react.development.js)
//        useKeepAwake (node_modules/expo-keep-awake/src/index.ts)
//        WithDevTools (node_modules/expo/src/launch/withDevTools.tsx)
//
//    `resolver.resolveRequest` is the only hook Metro consults *before* the
//    hierarchical lookup, so pinning here is what guarantees one instance.
//    (`extraNodeModules` cannot do this: Metro appends those candidates after
//    the hierarchical ones, which have already matched.)
// ---------------------------------------------------------------------------
const SINGLE_INSTANCE_PACKAGES = new Set([
  'react',
  'react-dom',
  'react-is',
  'scheduler',
  'use-sync-external-store',
  // react-native is only ever installed inside mobile/node_modules, but pin it
  // explicitly so a hoisted Expo package can never pick up a second copy.
  'react-native',
]);

function packageNameOf(moduleName) {
  const [first, second] = moduleName.split('/');
  return first.startsWith('@') ? `${first}/${second}` : first;
}

/**
 * Absolute path this module must resolve to, or null to keep Metro's default
 * behaviour. Only pinned packages are redirected, and only when the mobile
 * workspace actually has its own copy — otherwise leave the hoisted one alone
 * (a monorepo that dedupes React to a single copy needs no redirect).
 */
function pinnedTargetFor(moduleName) {
  if (moduleName.startsWith('.') || path.isAbsolute(moduleName)) return null;
  const packageName = packageNameOf(moduleName);
  if (!SINGLE_INSTANCE_PACKAGES.has(packageName)) return null;

  // Test the *package*, not the subpath: subpath imports carry no extension
  // (`react/jsx-runtime` is <pkg>/jsx-runtime.js), so stat-ing the subpath
  // itself would miss them — and those are exactly the modules that drag a
  // second copy of React into the bundle.
  const packageDir = path.join(projectNodeModules, ...packageName.split('/'));
  if (!fs.existsSync(packageDir)) return null;

  return path.join(projectNodeModules, ...moduleName.split('/'));
}

function versionOf(dir) {
  try {
    return require(path.join(dir, 'package.json')).version;
  } catch {
    return null;
  }
}

// Loud, one-line reminder when the dedupe is actually doing work. If this ever
// stops printing, the monorepo finally agrees on one React — at which point the
// redirect above is a harmless no-op.
const mobileReact = versionOf(path.join(projectNodeModules, 'react'));
const rootReact = versionOf(path.join(monorepoNodeModules, 'react'));
if (mobileReact && rootReact && mobileReact !== rootReact) {
  console.log(
    `[metro] React is duplicated across the workspace (mobile: ${mobileReact}, root: ${rootReact}); ` +
      `pinning the mobile bundle to ${mobileReact}.`,
  );
}

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = pinnedTargetFor(moduleName);
  if (pinned) {
    try {
      // An absolute path short-circuits Metro's bare-specifier lookup and goes
      // straight to its file resolution, which still applies the normal
      // `react-native` → `browser` → `main` field order, the configured
      // extensions and the platform suffixes (.android.js, .native.js, …).
      return context.resolveRequest(context, pinned, platform);
    } catch {
      // The pinned copy does not ship this particular subpath. Fall back to the
      // hoisted copy instead of failing the bundle.
    }
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
