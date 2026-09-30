/**
 * What a native MapLibre log line is allowed to mean.
 *
 * ### The failure this module exists for
 *
 * The classifier this replaces treated **any** MapLibre log at `warn` or
 * `error` whose text merely *contained* `style`, `maplibre` or `mbgl` as a
 * style-load failure. maplibre-native emits exactly those lines all day on a
 * perfectly healthy map:
 *
 * - `Unsupported style property: …` when a style uses a newer spec feature;
 * - a sprite image that is missing from the sheet;
 * - one tile that 404s at the edge of the viewport;
 * - a request cancelled because the user panned away mid-flight.
 *
 * So a driver on a good network got a red "Map failed to load — check your
 * network connection and map tiles" over a map that was drawing fine. The
 * substring heuristic is gone; what remains is a **strict allow-list of
 * genuinely fatal patterns**, and everything else returns `null`.
 *
 * ### The other half of the rule (in `map-style-controller.ts`)
 *
 * Even a fatal-looking line may only **corroborate** a failure the style
 * pipeline already concluded — a log line never raises an issue by itself.
 * Recovery is scheduled by the engine's `onDidFailLoadingMap` event and the
 * bounded policy in `map-style-recovery.ts`, not by log noise.
 *
 * Pure — no React, no native imports — so `map-log-classifier.spec.ts` pins
 * every branch under plain `node --test`.
 */

import type { MapStyleIssueCode } from './map-style.ts';

/**
 * Phrases maplibre-native emits only when the **whole style** failed.
 *
 * Deliberately exact. A pattern earns its place here by being impossible to
 * emit while the map is still usable.
 */
export const FATAL_STYLE_LOG_PATTERNS: readonly RegExp[] = [
  /failed to load style/i,
  /unable to fetch style/i,
  /style is not done loading/i,
  /error (?:parsing|loading) style/i,
];

/**
 * Phrases that mean the **fonts endpoint** is gone, not that one range is.
 *
 * A single missing glyph range draws a few labels without their glyphs; it is
 * not "labels unavailable", and the pipeline's own glyph probe
 * (`verifyGlyphs`) is the authority on the endpoint's health anyway.
 */
export const FATAL_GLYPH_LOG_PATTERNS: readonly RegExp[] = [
  /failed to load glyphs\b/i,
  /unable to fetch glyphs\b/i,
  /glyphs? (?:url|template) (?:is )?(?:missing|invalid)/i,
];

/** A single glyph *range* miss — noise, never a verdict. */
const GLYPH_RANGE_MISS = /\brange\b|\d{1,6}-\d{1,6}\.pbf/i;

/**
 * A style request that came back 4xx/5xx.
 *
 * Both halves are required: the line must name the style resource **and**
 * carry an HTTP failure status. A bare `404` in a tile log stays a tile log.
 */
const STYLE_RESOURCE = /(?:\bstyle\.json\b|\/styles?\/|\bstyle\b)/i;
const HTTP_FAILURE = /\b(?:http|status)(?:\s*code)?\s*[:=]?\s*([45]\d{2})\b/i;

/** Log levels worth reading at all. */
const CONSIDERED_LEVELS = new Set(['error', 'warn']);

/**
 * Classifies a native log line into a map issue code, or `null` to ignore.
 *
 * `null` is the overwhelmingly common answer, and that is the point.
 */
export function classifyMapLog(
  level: string,
  tag: string | null,
  message: string | null,
): MapStyleIssueCode | null {
  if (!CONSIDERED_LEVELS.has(level)) return null;
  const text = `${tag ?? ''} ${message ?? ''}`.trim();
  if (text === '') return null;

  // Glyphs first: a fatal *style* phrase can legitimately mention fonts, but
  // a fonts-only failure must never be reported as a dead style.
  if (FATAL_GLYPH_LOG_PATTERNS.some((pattern) => pattern.test(text))) {
    return GLYPH_RANGE_MISS.test(text) ? null : 'glyphs';
  }

  if (FATAL_STYLE_LOG_PATTERNS.some((pattern) => pattern.test(text))) return 'styleLoad';

  const httpFailure = HTTP_FAILURE.exec(text);
  if (httpFailure !== null && STYLE_RESOURCE.test(text) && !/glyph|font|sprite/i.test(text)) {
    return 'styleLoad';
  }

  // Everything else — "Unsupported style property", a cancelled request, one
  // 404 tile, any line that merely says "maplibre" or "mbgl" — is noise.
  return null;
}
