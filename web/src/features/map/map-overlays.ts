/**
 * Map overlay wiring helpers — the "is the map actually ready for this?" seam.
 *
 * Why this module exists
 * ----------------------
 * The bus marker used to vanish permanently on any trip whose only fix came
 * from the REST snapshot. The ordering was:
 *
 *   1. first render — the WebGL support check has not resolved, so no map
 *      object is created yet;
 *   2. the REST snapshot resolves, `fix` is set, the marker effect runs and
 *      bails out on `if (!mapRef.current) return;`;
 *   3. the WebGL check resolves, a re-render happens, the map is created;
 *   4. nothing in the marker effect's dependency array changed, so it never
 *      ran again — no bus, forever.
 *
 * The bug was not "the marker code is wrong", it was "the marker code ran at a
 * moment when there was nothing to attach it to, and silently gave up". The
 * cure is an explicit readiness signal (`mapReady`, flipped inside the map's
 * own `load` event) that every overlay effect depends on, plus this module,
 * which makes the decision itself a pure, testable function rather than an
 * early `return` buried in an effect.
 *
 * The helpers are generic over the map/marker types on purpose: the component
 * passes MapLibre objects, the spec passes a fake map. Nothing here imports
 * `maplibre-gl`, so the behaviour can be pinned without a DOM or a GL context.
 */

/** The only thing overlay syncing needs from a marker. */
export interface MarkerLike {
  remove(): void;
}

/** A geographic position, in the app's `{ latitude, longitude }` convention. */
export interface OverlayPosition {
  latitude: number;
  longitude: number;
}

/**
 * What `syncBusMarker` did, so the caller can react without re-deriving it.
 *
 * - `created` — a marker was just added to the map (the caller should run its
 *   first-fit / camera framing for this trip).
 * - `kept`    — the marker already existed and was left in place.
 * - `removed` — there is no position any more, so the marker was torn down.
 * - `deferred`— the map is not ready yet; nothing was touched and the caller
 *   must call again once it is. This is the state that used to be a silent
 *   dead end.
 */
export type BusMarkerSyncAction = 'created' | 'kept' | 'removed' | 'deferred';

export interface BusMarkerSyncResult<TMarker> {
  marker: TMarker | null;
  action: BusMarkerSyncAction;
}

export interface BusMarkerSyncArgs<TMap, TMarker extends MarkerLike> {
  /** The map instance, or null before it has been constructed. */
  map: TMap | null;
  /** True only once the map has fired `load` (style + sources usable). */
  ready: boolean;
  /** The position to show the bus at, or null when there is no fix. */
  position: OverlayPosition | null;
  /** The marker currently on the map, if any. */
  marker: TMarker | null;
  /** Builds and attaches a marker. Only called when the map is ready. */
  createMarker: (map: TMap, lngLat: [number, number]) => TMarker;
}

/**
 * Reconcile the bus marker against the current fix and map readiness.
 *
 * Deliberately *does not* remove the marker when the map is merely not ready:
 * a map being rebuilt (style change, remount) should not be indistinguishable
 * from "the bus went away".
 */
export function syncBusMarker<TMap, TMarker extends MarkerLike>({
  map,
  ready,
  position,
  marker,
  createMarker,
}: BusMarkerSyncArgs<TMap, TMarker>): BusMarkerSyncResult<TMarker> {
  if (!position) {
    marker?.remove();
    return { marker: null, action: 'removed' };
  }

  // No map, or a map whose style has not finished loading: keep whatever we
  // have and tell the caller to come back. The `mapReady` dependency on the
  // calling effect is what guarantees "come back" actually happens.
  if (!map || !ready) {
    return { marker, action: 'deferred' };
  }

  if (marker) {
    return { marker, action: 'kept' };
  }

  return {
    marker: createMarker(map, [position.longitude, position.latitude]),
    action: 'created',
  };
}

/**
 * Should an overlay effect touch the map at all right now?
 *
 * One predicate, used by every imperative overlay effect, so that "the map
 * exists" and "the map's style is loaded" can never drift apart between them.
 */
export function canSyncOverlays(map: unknown, ready: boolean): boolean {
  return Boolean(map) && ready;
}
