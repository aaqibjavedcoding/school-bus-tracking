/**
 * What counts as "the map failed", on the web.
 *
 * Before this module, `map.on('error', …)` called `onMapError('Map failed to
 * load')` for *every* error MapLibre emitted. MapLibre emits an error event
 * for each individual tile request that 404s, for every request aborted
 * because the user panned away mid-flight, and for assorted style-property
 * complaints. On a perfectly healthy network the admin tracking screen would
 * therefore light up a red "Map failed to load — check your network
 * connection and map tiles" badge over a map that was working fine.
 *
 * The rules encoded here:
 *
 * 1. **Only style-level failures count.** A MapLibre error event carries a
 *    `sourceId` when it came from a tile/source request. Those are routine and
 *    self-healing (MapLibre retries, and a missing tile just renders grey).
 *    An error with no `sourceId`, or one whose failed request *is* the style
 *    document, is the kind that leaves you with a blank map.
 * 2. **Aborts are never failures.** Panning cancels in-flight requests by
 *    design.
 * 3. **Three consecutive failures inside a short window**, or nothing. One
 *    blip must never reach the user.
 * 4. **Retrying is not failing.** The first time the threshold trips we say
 *    "Map tiles unavailable — retrying…". Only a sustained run of failures
 *    (or a genuinely fatal event such as an init throw or WebGL context loss)
 *    earns the flat "Map failed to load".
 * 5. **Recovery is automatic.** A successful `styledata` or an `idle` event
 *    means the map is drawing again, which clears everything with no user
 *    action — no restart, no "Retry map" tap.
 *
 * Pure and dependency-free so it can be pinned by a spec without a GL context.
 */

/** Consecutive style-level failures required before the user sees anything. */
export const MAP_ERROR_THRESHOLD = 3;

/**
 * Failures older than this are forgotten. Three failures spread over ten
 * minutes is a flaky tile CDN, not an outage; three inside a few seconds is.
 */
export const MAP_ERROR_WINDOW_MS = 15_000;

/**
 * Consecutive style-level failures after which we stop calling it "retrying".
 * Double the surfacing threshold: by then MapLibre's own retries have had
 * their turn and the map really is not coming back on its own.
 */
export const MAP_ERROR_GIVE_UP_THRESHOLD = 6;

/** Shown while the map is still expected to recover by itself. */
export const MAP_RETRYING_MESSAGE = 'Map tiles unavailable — retrying…';

/** Shown only once recovery has genuinely been given up on. */
export const MAP_FAILED_MESSAGE = 'Map failed to load';

/**
 * How an error event was read.
 *
 * - `style` — a style-level failure; counts towards the threshold.
 * - `source` — a per-tile/source failure; recorded for diagnostics, never
 *   surfaced on its own.
 * - `abort` — a request cancelled by a pan/zoom; not a failure at all.
 * - `fatal` — map construction threw or the WebGL context was lost; there is
 *   nothing to retry, so it surfaces immediately.
 */
export type MapErrorKind = 'style' | 'source' | 'abort' | 'fatal';

/** The shape of a MapLibre `error` event, reduced to what we read. */
export interface MapErrorEventLike {
  sourceId?: string;
  error?: {
    message?: string;
    status?: number;
    url?: string;
    name?: string;
  } | null;
}

function readEvent(event: unknown): MapErrorEventLike {
  return (event ?? {}) as MapErrorEventLike;
}

/** The raw text we log for diagnostics — never shown to the user. */
export function describeMapError(event: unknown): string {
  const parsed = readEvent(event);
  const parts: string[] = [];
  if (parsed.sourceId) parts.push(`source=${parsed.sourceId}`);
  if (parsed.error?.status != null) parts.push(`status=${parsed.error.status}`);
  if (parsed.error?.url) parts.push(`url=${parsed.error.url}`);
  parts.push(parsed.error?.message ?? 'map error');
  return parts.join(' ');
}

/**
 * Decide what kind of failure (if any) an error event represents.
 *
 * `styleUrl` is the resolved style document URL; a request failure against it
 * is style-level even when MapLibre attributes it to a source.
 */
export function classifyMapErrorEvent(event: unknown, styleUrl?: string | null): MapErrorKind {
  const parsed = readEvent(event);
  const message = parsed.error?.message ?? '';
  const name = parsed.error?.name ?? '';

  // A pan cancels in-flight requests. That is the map working, not failing.
  if (name === 'AbortError' || /\babort(ed)?\b/i.test(message)) {
    return 'abort';
  }

  if (/webgl context lost|context lost|failed to initialize webgl/i.test(message)) {
    return 'fatal';
  }

  const url = parsed.error?.url ?? '';
  if (styleUrl && url && url === styleUrl) {
    return 'style';
  }

  // Anything attributed to a source is a tile/sprite/glyph request. One 404
  // there is a grey square, not an outage.
  if (parsed.sourceId) {
    return 'source';
  }

  return 'style';
}

export type MapNoticeKind = 'none' | 'retrying' | 'failed';

export interface MapErrorState {
  /** Timestamps of recent style-level failures, oldest first. */
  readonly failures: readonly number[];
  /** What the user should be told right now. */
  readonly notice: MapNoticeKind;
}

export const INITIAL_MAP_ERROR_STATE: MapErrorState = {
  failures: [],
  notice: 'none',
};

/** The user-visible string for a notice, or null when there is nothing to say. */
export function mapNoticeMessage(notice: MapNoticeKind): string | null {
  if (notice === 'retrying') return MAP_RETRYING_MESSAGE;
  if (notice === 'failed') return MAP_FAILED_MESSAGE;
  return null;
}

/**
 * Fold one error event into the state.
 *
 * Returns the same object identity when nothing changed, so callers can skip
 * a re-render cheaply.
 */
export function recordMapError(
  state: MapErrorState,
  kind: MapErrorKind,
  at: number,
): MapErrorState {
  if (kind === 'abort' || kind === 'source') {
    // Recorded in the console for diagnostics by the caller; it changes
    // nothing the user can see.
    return state;
  }

  if (kind === 'fatal') {
    // Nothing to retry: the map object itself is unusable.
    return { failures: [...state.failures, at], notice: 'failed' };
  }

  const failures = [...state.failures, at].filter((t) => at - t < MAP_ERROR_WINDOW_MS);

  if (failures.length >= MAP_ERROR_GIVE_UP_THRESHOLD) {
    return { failures, notice: 'failed' };
  }
  if (failures.length >= MAP_ERROR_THRESHOLD) {
    return { failures, notice: 'retrying' };
  }
  return { failures, notice: 'none' };
}

/**
 * The map drew something (`styledata` with a loaded style, or `idle`).
 *
 * Whatever was wrong is over: drop the failure history *and* the notice, with
 * no user action required.
 */
export function clearMapError(state: MapErrorState): MapErrorState {
  if (state.failures.length === 0 && state.notice === 'none') return state;
  return INITIAL_MAP_ERROR_STATE;
}
