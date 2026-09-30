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

// ── Raw native-log records (diagnostics only, never user-visible) ─────────
//
// Native MapLibre log lines used to *raise* map issues directly, which is how
// a routine warning ("unsupported style property", one sprite miss, a request
// cancelled by a fast pan) turned into a red "Map failed to load" over a map
// that was working. Log lines no longer raise anything — that judgement
// belongs to the style pipeline, which actually knows whether the style
// rendered.
//
// They are still recorded here, verbatim, so Help → Diagnostics can name what
// failed from a field screenshot. A record is evidence, not a verdict.

/** Cap on remembered log records — most recent wins; this is not a log file. */
export const MAX_LOG_RECORDS = 5;

export interface MapLogRecord {
  /** What the line looked like about, for grouping. */
  code: MapStyleIssueCode;
  /** The raw native text, untranslated, as the screenshot will show it. */
  text: string;
  /** How many times an identical line has been seen. */
  count: number;
}

let logRecords: readonly MapLogRecord[] = [];

/**
 * Records one classified native log line for diagnostics.
 *
 * Deliberately does **not** call `reportMapIssue`: corroborating evidence for
 * a conclusion the pipeline reached is useful, inventing the conclusion from a
 * warning is the bug this whole change exists to remove.
 */
export function recordMapLog(code: MapStyleIssueCode, text: string): void {
  const trimmed = text.trim();
  const existing = logRecords.find((record) => record.code === code && record.text === trimmed);
  if (existing) {
    logRecords = logRecords.map((record) =>
      record === existing ? { ...record, count: record.count + 1 } : record,
    );
    notify();
    return;
  }
  logRecords = [...logRecords, { code, text: trimmed, count: 1 }].slice(-MAX_LOG_RECORDS);
  notify();
}

/** The raw log records, oldest first. */
export function getMapLogRecords(): readonly MapLogRecord[] {
  return logRecords;
}

/** Test seam: back to "no issues, no listeners leaked" state. */
export function resetMapIssuesForTests(): void {
  issues = [];
  logRecords = [];
  retryHandler = null;
  listeners.clear();
}

// ── Retry affordance ──────────────────────────────────────────────────────
//
// `MapIssueLines` renders inside both map panels and reads this store
// directly rather than taking props through two component trees. The retry
// button it shows for the degraded (offline-fallback) state needs to reach
// the style pipeline, so the pipeline registers its retry here the same way
// it reports issues here.

let retryHandler: (() => void) | null = null;

/** `useMapStyle` registers its "re-run the style pipeline now" callback. */
export function setMapRetryHandler(handler: (() => void) | null): void {
  retryHandler = handler;
  notify();
}

/** True when a retry affordance can actually do something. */
export function canRetryMap(): boolean {
  return retryHandler !== null;
}

/** Invoked by the retry affordance on the map panel. No-op when unregistered. */
export function requestMapRetry(): void {
  retryHandler?.();
}
