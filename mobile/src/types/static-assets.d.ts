/**
 * Ambient module declarations for the static assets the **web-only** files
 * import.
 *
 * The mobile web fallbacks (`*.web.tsx`, e.g. `LiveWebViewMap.web.tsx`) are
 * bundled by Metro for the web platform only — the native builds never see
 * them — but `tsc` typechecks every `.tsx` in `src/` on every platform, so
 * the side-effect CSS import that loads MapLibre GL JS's own stylesheet (and
 * any asset require Metro resolves) needs a declaration to typecheck.
 */
declare module '*.css';
