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
 * codes, duplicates ignored, listeners notified.
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

/** Test seam: back to "no issues, no listeners leaked" state. */
export function resetMapIssuesForTests(): void {
  issues = [];
  listeners.clear();
}
