/**
 * Ambient declaration for `compressible` — mirrors
 * `src/server/common/middleware/compressible.d.ts`.
 *
 * Two copies exist because the client typecheck (`tsconfig.json`) pulls the
 * server graph into its program through `instrumentation.ts` → `src/server`,
 * but its `exclude` for that folder prevents ambient `.d.ts` files inside it
 * from loading, so this copy lives in an included folder.
 * `tsconfig.build.json` keeps the server copy (its `rootDir: src/server`
 * forbids files from `src/types`). Keep both in sync; the module surface is
 * deliberately tiny.
 */
declare module 'compressible' {
  /** True when `type` (e.g. `application/json`) may be worth compressing. */
  function compressible(type: string): boolean;
  export default compressible;
}
