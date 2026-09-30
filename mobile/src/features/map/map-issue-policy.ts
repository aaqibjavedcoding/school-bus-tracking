/**
 * What the map should *say* — the pure half of the map-health story.
 *
 * ### The defect this module exists to end
 *
 * "Map failed to load — check your network connection and map tiles", in red,
 * on every tracking screen, with the network on and the map visibly working.
 * Two independent causes, both of them a judgement made in the wrong place:
 *
 * 1. **Native log lines raised issues.** `classifyMapLog` treated any
 *    MapLibre log at warn/error whose text merely *contained* "style",
 *    "maplibre" or "mbgl" as a style-load failure. MapLibre-native emits such
 *    lines routinely — an unsupported style property, a sprite miss, one 404
 *    tile, a request cancelled by a fast pan — so a healthy map raised the
 *    alarm about itself within seconds of opening.
 * 2. **Failures were reported before the retries ran.** The pipeline reported
 *    `styleLoad` on the *first* engine failure, contradicting the bounded
 *    backoff in `map-style-recovery.ts` that was about to fix it. One flaky
 *    request on mobile data read as a dead map.
 *
 * ### The rules, stated once
 *
 * - A log line may **corroborate** a conclusion the style pipeline reached.
 *   It may never reach one by itself. `classifyMapLog` is now a strict
 *   allow-list of genuinely fatal phrasings (plus a 4xx/5xx against the style
 *   document or the fonts endpoint) and is used only to record diagnostics.
 * - **Silence during retries.** While `planStyleLoadFailure` still has budget,
 *   the user is told nothing: a retry in flight is not news.
 * - **A working offline map is not a failure.** When the budget is spent the
 *   map drops to the bundled offline base style and keeps drawing stops, the
 *   route and the bus. That is `offlineFallback` — a neutral chip with a
 *   retry — not the red `styleLoad`.
 * - **Red is for terminal only.** `styleLoad` means the zero-network fallback
 *   itself did not load: nothing renders, nothing is left to try.
 * - **Recovery is automatic.** A load that succeeds clears the terminal line;
 *   a load of a *real* style clears the degraded chip; and the network coming
 *   back re-runs the whole pipeline with a fresh budget.
 *
 * Pure: no React, no native imports, no timers — so `map-issue-policy.spec.ts`
 * pins every one of those rules under plain `node --test`.
 */

import type { MapStyleFailureAction } from './map-style-recovery.ts';
import type { MapStyleIssueCode } from './map-style.ts';

/**
 * Genuinely fatal style log lines. Everything else is noise.
 *
 * MapLibre-native logs at warn/error for a long list of non-events: an
 * unsupported style property, a sprite that is not in the atlas, one tile
 * that 404s, a request cancelled because the user panned. The previous
 * classifier matched any warn/error whose text merely *contained* "style",
 * "maplibre" or "mbgl" — i.e. very nearly every line the engine ever
 * emits — which is why a healthy map on a good network showed "Map failed to
 * load — check your network connection and map tiles".
 */
const FATAL_STYLE_PATTERNS: readonly RegExp[] = [
  /failed to load style/i,
  /unable to fetch style/i,
  /style is not done loading/i,
  /failed to load \[style\]/i,
];

/**
 * Genuinely fatal glyph log lines.
 *
 * One missing glyph range is a few characters drawn as boxes, not "labels
 * unavailable" — and the pipeline's own glyph probe (`verifyGlyphs`) is the
 * authority on whether the fonts endpoint answers at all.
 */
const FATAL_GLYPH_PATTERNS: readonly RegExp[] = [
  /unable to fetch glyphs/i,
  /glyphs are not available/i,
  /failed to load \[glyphs\]/i,
];

/** The HTTP status a log line is reporting, if it is reporting one. */
function readHttpStatus(text: string): number | null {
  const match = /\b(?:http|https|status|code)\b[^0-9]{0,12}(\d{3})\b/i.exec(text);
  if (!match) return null;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : null;
}

/** Does this line name the style document (rather than a tile or a sprite)? */
function mentionsStyleDocument(text: string): boolean {
  return /style\.json|\/styles?\//i.test(text);
}

/** Does this line name the glyph/fonts endpoint? */
function mentionsGlyphEndpoint(text: string): boolean {
  return /\/fonts?\/|glyph/i.test(text);
}

/**
 * Classifies a native log line into a map issue code, or `null` to ignore.
 *
 * A strict allow-list: only phrases that mean the style pipeline is actually
 * broken, plus a 4xx/5xx against the style document or the fonts endpoint.
 * Anything else — including any line that merely mentions "maplibre" — is
 * `null`, because the engine says those things while working perfectly.
 *
 * Note this is now only used to *record diagnostics*: see the `LogManager`
 * subscription below. A log line may corroborate a conclusion the style
 * pipeline reached; it may never reach one on its own.
 */
export function classifyMapLog(
  level: string,
  tag: string | null,
  message: string | null,
): MapStyleIssueCode | null {
  if (level !== 'error' && level !== 'warn') return null;
  const text = `${tag ?? ''} ${message ?? ''}`;

  if (FATAL_STYLE_PATTERNS.some((pattern) => pattern.test(text))) return 'styleLoad';
  if (FATAL_GLYPH_PATTERNS.some((pattern) => pattern.test(text))) return 'glyphs';

  const status = readHttpStatus(text);
  if (status !== null && status >= 400) {
    if (mentionsStyleDocument(text)) return 'styleLoad';
    if (mentionsGlyphEndpoint(text)) return 'glyphs';
  }

  // A tile 404, a sprite miss, an aborted request, an unsupported style
  // property, or anything else the engine feels chatty about. Not an outage.
  return null;
}

/** Issues to report and to clear, as a pair, so a decision is atomic. */
export interface MapIssuePlan {
  report: readonly MapStyleIssueCode[];
  clear: readonly MapStyleIssueCode[];
}

const NOTHING: MapIssuePlan = { report: [], clear: [] };

export interface StyleFailureReportingInput {
  /** What `planStyleLoadFailure` decided to do about this failure. */
  action: MapStyleFailureAction;
  /** Is the bundled offline base style what the map is currently showing? */
  showingFallback: boolean;
}

/**
 * What to tell the user about one native style-load failure.
 *
 * The ordering matters and is the whole fix: the report follows the *plan*,
 * never precedes it. While a retry is scheduled the answer is "say nothing",
 * because the bounded backoff is very likely about to succeed and a red line
 * that disappears by itself teaches users to distrust every line.
 */
export function planStyleFailureReporting(input: StyleFailureReportingInput): MapIssuePlan {
  switch (input.action.kind) {
    case 'retry':
      // Budget remains. Silence.
      return NOTHING;

    case 'fallback':
      // Budget spent: the map is about to draw the bundled offline style.
      // Degraded — the map still works — so a neutral chip, not a failure.
      return { report: ['offlineFallback'], clear: [] };

    case 'wait':
      // `wait` with the fallback already showing means the zero-network
      // fallback *itself* failed. Nothing renders; this is the terminal
      // state, and the only one that earns the red line.
      return input.showingFallback ? { report: ['styleLoad'], clear: [] } : NOTHING;
  }
}

/**
 * What to clear when the engine reports a style finished loading.
 *
 * Something rendered, so the terminal "nothing renders" line is false
 * whatever it was that rendered. The degraded chip only clears when what
 * loaded is a real, online style: the fallback loading is not the tiles
 * coming back.
 */
export function planStyleLoadedReporting(showingFallback: boolean): MapIssuePlan {
  return {
    report: [],
    clear: showingFallback ? ['styleLoad'] : ['styleLoad', 'offlineFallback'],
  };
}

/**
 * Should the network transition `previous -> next` re-run the style pipeline?
 *
 * Only an actual arrival at `online`. `unknown -> online` counts (the app may
 * have launched in a dead zone and NetInfo resolves late); `online -> online`
 * does not, or a chatty NetInfo would hammer the style endpoint.
 */
export function shouldRetryOnNetworkChange(previous: string, next: string): boolean {
  return next === 'online' && previous !== 'online';
}
