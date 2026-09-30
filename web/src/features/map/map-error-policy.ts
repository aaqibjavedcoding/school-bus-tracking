/**
 * What a MapLibre `error` event actually means — and when the user may be
 * told about it.
 *
 * ### The failure this module exists for
 *
 * `MapViewInner` used to wire `map.on('error', …)` straight to
 * `onMapError('Map failed to load')`. MapLibre GL JS fires that event for
 * **everything**: one tile that 404s at the edge of the viewport, a request
 * aborted because the user panned away mid-flight, a sprite that is missing an
 * icon. So a perfectly working map — the tiles drawn, the bus moving — showed
 * a red "Map failed to load" badge, and `TripTracker` never cleared it except
 * on a manual "Retry map" click. The badge was a lie, and a lie that stuck.
 *
 * ### The policy, stated once
 *
 * 1. **Classify, do not count blindly** (`classifyMapErrorEvent`). A per-source
 *    error (`event.sourceId` present) is a *tile* problem: the rest of the map
 *    still renders, so it never reaches the user. Glyph/sprite/tile sub-resource
 *    failures are the same. Aborted requests are not failures at all. Only a
 *    style-level failure — no `sourceId`, or a request failure on the style URL
 *    itself — can ever be surfaced.
 * 2. **Three in a short window** (`createMapErrorTracker`). Even a style-level
 *    error can be a blip, so nothing is said until `SURFACE_AFTER_FAILURES`
 *    consecutive style failures land inside `FAILURE_WINDOW_MS`.
 * 3. **Say what is true.** While the map is still retrying, the copy is
 *    `MAP_RETRYING_MESSAGE`; `MAP_FAILED_MESSAGE` is reserved for the state
 *    where the retry budget is spent (`GIVE_UP_AFTER_FAILURES`) or the map
 *    could not be constructed at all (`fail()`).
 * 4. **Recovery clears it** (`recover()`), wired to `idle` / `styledata` — a
 *    successful render is proof the outage is over, so the notice disappears
 *    on its own. No restart, no manual tap.
 * 5. **Keep the raw codes.** Every classified event contributes a short,
 *    untranslated code to `notice.codes`, so a field screenshot can name what
 *    failed even though the copy stays calm.
 *
 * Pure: no DOM, no MapLibre import, no timers — `now` is a parameter. Pinned
 * by `map-error-policy.spec.ts` under plain `node --test`.
 */

/** What one MapLibre `error` event is, for the purposes of telling the user. */
export type MapErrorSeverity =
  /** Not a failure (an aborted request, an unreadable event). Say nothing. */
  | 'ignore'
  /** One tile / glyph / sprite sub-resource. The map still works. */
  | 'tile'
  /** The style itself did not load. This is the only surfaceable kind. */
  | 'style';

/** The shape of a MapLibre GL JS error event, narrowed to what we read. */
export interface MapErrorEventLike {
  /** Present only for errors raised by a *source* (i.e. a tile request). */
  sourceId?: string | null;
  error?: {
    message?: string;
    name?: string;
    status?: number;
    url?: string;
  } | null;
}

/** Consecutive style failures required before the user is told anything. */
export const SURFACE_AFTER_FAILURES = 3;

/**
 * Consecutive style failures after which the map has genuinely given up.
 *
 * `MapViewInner` re-sets the style on a bounded backoff, so this is the
 * failure count at which that budget is spent: the three scheduled retries
 * plus the original failure and the surfaced-notice threshold above it.
 */
export const GIVE_UP_AFTER_FAILURES = 6;

/**
 * The window the consecutive failures must land inside, in ms.
 *
 * Long enough to cover the bounded re-set backoff (2 s + 5 s + 15 s), short
 * enough that three unrelated blips spread over a whole trip never add up to
 * a notice.
 */
export const FAILURE_WINDOW_MS = 30_000;

/** Backoff for the style re-set, mirroring the mobile pipeline's schedule. */
export const STYLE_RESET_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000];

/** Honest copy while the map is still trying. */
export const MAP_RETRYING_MESSAGE = 'Map tiles unavailable — retrying…';

/** Honest copy once it has stopped trying. */
export const MAP_FAILED_MESSAGE = 'Map failed to load';

/** Cap on remembered raw codes — a status line, not a log file. */
export const MAX_DIAGNOSTIC_CODES = 5;

/** What the surface should show right now. */
export interface MapErrorNotice {
  /** `none` = say nothing at all. */
  kind: 'none' | 'retrying' | 'failed';
  /** The copy to render, or `null` when there is nothing to say. */
  message: string | null;
  /**
   * Untranslated engine codes, oldest first — the token a field screenshot
   * can quote verbatim. Never rendered as prose.
   */
  codes: readonly string[];
}

const QUIET: MapErrorNotice = { kind: 'none', message: null, codes: [] };

/** Requests that were cancelled on purpose — panning away is not a failure. */
const ABORTED = /\b(abort|aborted|cancell?ed|signal is aborted)\b/i;

/** Sub-resources whose individual failure leaves a working map behind. */
const SUB_RESOURCE = /(glyph|font|sprite|\.pbf\b|\.png\b|\.jpg\b|\.webp\b|\btile\b|\/tiles?\/)/i;

function readEvent(event: unknown): MapErrorEventLike | null {
  if (event === null || typeof event !== 'object') return null;
  return event as MapErrorEventLike;
}

function errorText(event: MapErrorEventLike): string {
  const error = event.error ?? null;
  return [error?.name, error?.message, error?.url].filter(Boolean).join(' ');
}

/**
 * Decides what one `error` event is.
 *
 * @param event the MapLibre event object (anything else is `ignore`).
 * @param styleUrl the style URL in force, so a failing request *for the style*
 *   is still style-level even when the engine attributes it to a source.
 */
export function classifyMapErrorEvent(event: unknown, styleUrl?: string | null): MapErrorSeverity {
  const parsed = readEvent(event);
  if (parsed === null) return 'ignore';

  const text = errorText(parsed);
  if (text !== '' && ABORTED.test(text)) return 'ignore';

  const url = parsed.error?.url ?? '';
  const status = parsed.error?.status;
  const httpFailed = typeof status === 'number' && status >= 400;

  // A request failure on the style document itself is style-level, whatever
  // the engine attributed it to.
  if (styleUrl != null && styleUrl !== '' && url !== '' && url.split('?')[0] === styleUrl) {
    return 'style';
  }

  // `sourceId` means "this came from a source", i.e. a tile request. The rest
  // of the map is unaffected, so the user never hears about it.
  if (typeof parsed.sourceId === 'string' && parsed.sourceId !== '') return 'tile';

  // No sourceId, but the text names a sub-resource (a glyph range, a sprite
  // sheet, one tile): still not the style.
  if (text !== '' && SUB_RESOURCE.test(text)) return 'tile';

  // An HTTP failure with no source and no sub-resource is the style document.
  if (httpFailed) return 'style';

  // Everything else with no source — a style parse error, a WebGL context
  // loss, a network error on the style fetch — is style-level.
  return 'style';
}

/**
 * A short, untranslated code for one event: what a support screenshot quotes.
 *
 * Deliberately coarse (`style:404`, `tile:sbt-route`, `style:webgl`): it names
 * the failing thing without leaking a signed tile URL into a screenshot.
 */
export function mapErrorCode(event: unknown, severity: MapErrorSeverity): string {
  const parsed = readEvent(event);
  const status = parsed?.error?.status;
  if (typeof status === 'number' && status > 0) return `${severity}:${status}`;
  if (severity === 'tile' && typeof parsed?.sourceId === 'string' && parsed.sourceId !== '') {
    return `tile:${parsed.sourceId}`;
  }
  const message = parsed?.error?.message ?? '';
  if (/webgl|context lost/i.test(message)) return `${severity}:webgl`;
  if (/json|parse|unexpected token/i.test(message)) return `${severity}:parse`;
  return `${severity}:error`;
}

export interface MapErrorTracker {
  /** Feeds one `error` event in and returns what should be shown now. */
  record(event: unknown, nowMs: number): MapErrorNotice;
  /** A successful render (`idle` / `styledata`): everything clears. */
  recover(): MapErrorNotice;
  /** The map could not be constructed at all — terminal immediately. */
  fail(code?: string): MapErrorNotice;
  /** The current notice, without feeding anything in. */
  notice(): MapErrorNotice;
  /**
   * How many style-level failures are live in the window — the number that
   * drives the caller's bounded style re-set.
   */
  styleFailures(): number;
}

export interface MapErrorTrackerOptions {
  /** The style URL in force, for style-vs-tile attribution. */
  styleUrl?: string | null;
  surfaceAfter?: number;
  giveUpAfter?: number;
  windowMs?: number;
}

/**
 * The stateful half: consecutive style failures inside a window, and the
 * notice that follows from them.
 */
export function createMapErrorTracker(options: MapErrorTrackerOptions = {}): MapErrorTracker {
  const surfaceAfter = options.surfaceAfter ?? SURFACE_AFTER_FAILURES;
  const giveUpAfter = options.giveUpAfter ?? GIVE_UP_AFTER_FAILURES;
  const windowMs = options.windowMs ?? FAILURE_WINDOW_MS;

  let failures: number[] = [];
  let codes: string[] = [];
  let terminal = false;

  function pushCode(code: string): void {
    if (codes[codes.length - 1] === code) return;
    codes = [...codes, code].slice(-MAX_DIAGNOSTIC_CODES);
  }

  function current(): MapErrorNotice {
    if (terminal) return { kind: 'failed', message: MAP_FAILED_MESSAGE, codes };
    if (failures.length >= giveUpAfter) {
      return { kind: 'failed', message: MAP_FAILED_MESSAGE, codes };
    }
    if (failures.length >= surfaceAfter) {
      return { kind: 'retrying', message: MAP_RETRYING_MESSAGE, codes };
    }
    return { kind: 'none', message: null, codes };
  }

  return {
    record(event, nowMs) {
      const severity = classifyMapErrorEvent(event, options.styleUrl ?? null);
      if (severity === 'ignore') return current();
      // Every classified event is worth a diagnostic code, including the
      // tile errors that will never be shown: that is how a field report can
      // still say "it was the tiles".
      pushCode(mapErrorCode(event, severity));
      if (severity === 'tile') return current();
      failures = [...failures.filter((at) => nowMs - at <= windowMs), nowMs];
      return current();
    },

    recover() {
      failures = [];
      terminal = false;
      codes = [];
      return QUIET;
    },

    fail(code = 'style:init') {
      terminal = true;
      pushCode(code);
      return current();
    },

    notice: current,

    styleFailures() {
      return failures.length;
    },
  };
}
