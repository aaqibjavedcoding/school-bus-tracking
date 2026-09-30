/**
 * The map-diagnostics store: what went wrong with the native map's style or
 * labels, in a place every surface can read.
 *
 * MapLibre's Android build can fail a style or glyph fetch with nothing but a
 * native log line (see maplibre-native #3939 and the OpenFreeMap font-stack
 * 404 documented in `docs/live-tracking-map.md`), and a silent blank or
 * unlabeled map is exactly the failure mode this store exists to end. The
 * style pipeline (`use-map-style.ts`) and the native log bridge report here;
 * `MapIssueLines` renders the issues on the map panels and the Help screen's
 * diagnostics reads them through `crew-diagnostics.ts`.
 *
 * Pure TypeScript — no React, no native imports — so `map-diagnostics.spec.ts`
 * pins the contract under plain `node --test`: at most `MAX_ISSUES` distinct
 * codes, duplicates ignored, listeners notified, and (since deep-fix R3) an
 * issue clears when its condition is verified gone, never just by time passing.
 */

import type { MapStyleIssueCode } from './map-style.ts';

/** Cap on distinct remembered issues — a status line, not a log file. */
export const MAX_ISSUES = 3;

let issues: readonly MapStyleIssueCode[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Reports one map issue (`styleLoad` = the style never rendered,
 * `glyphs` = labels cannot draw). Duplicates collapse; the cap keeps a broken
 * map from flooding the panels.
 */
export function reportMapIssue(code: MapStyleIssueCode): void {
  if (issues.includes(code)) return;
  if (issues.length >= MAX_ISSUES) return;
  issues = [...issues, code];
  notify();
}

/**
 * Clears one issue — the recovery half of the store (deep-fix R3).
 *
 * A reported issue used to be forever: one flaky first fetch on mobile data
 * pinned a red line until the app restarted, long after the map had silently
 * recovered. Now a later successful style load clears `styleLoad` and a
 * successful glyph probe clears `glyphs`, so the panel always says what is
 * wrong **now**, not what once went wrong.
 *
 * Clearing an absent code is a no-op (no notify): a recovery path must be
 * safe to run idempotently without re-rendering the panels. A cleared code
 * may be reported again — recovery is a cycle, not an archive.
 */
export function clearMapIssue(code: MapStyleIssueCode): void {
  if (!issues.includes(code)) return;
  issues = issues.filter((current) => current !== code);
  notify();
}

/** The issues reported so far, in report order. */
export function getMapIssues(): readonly MapStyleIssueCode[] {
  return issues;
}

/** Subscribes to issue changes (React `useSyncExternalStore` shape). */
export function subscribeMapIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── The retry affordance ───────────────────────────────────────────────────
//
// `styleOffline` is a neutral chip that says "Offline map — tap to retry", so
// something has to own the tap. The style pipeline (`use-map-style.ts`)
// registers its `retryNow` here on mount and clears it on unmount; the chip
// (`map-issue-lines.tsx`) calls `runMapRetry()`.
//
// Registered rather than drilled as a prop because the chip renders inside
// two `React.memo`'d map panels (`BusMap`, `DriverTripMap`) that re-render on
// a 5 s status tick and have no business knowing about the style pipeline.

let retryHandler: (() => void) | null = null;

/** Registers (or clears, with `null`) the "retry the map style" action. */
export function setMapRetryHandler(handler: (() => void) | null): void {
  retryHandler = handler;
}

/** Runs the registered retry. A no-op when no map is mounted. */
export function runMapRetry(): void {
  retryHandler?.();
}

/** Test seam: back to "no issues, no listeners leaked" state. */
export function resetMapIssuesForTests(): void {
  issues = [];
  listeners.clear();
  retryHandler = null;
}
