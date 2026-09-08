/**
 * Ambient declaration for the `compressible` package (a transitive
 * dependency of `compression` that the middleware imports directly).
 * The package ships no types of its own.
 */
declare module 'compressible' {
  /** True when `type` (e.g. `application/json`) may be worth compressing. */
  function compressible(type: string): boolean;
  export default compressible;
}
