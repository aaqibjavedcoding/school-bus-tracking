/**
 * The web map's overlay writer — one routine that pushes the current data
 * onto the map, whenever the map happens to become available.
 *
 * ### The failure this module exists for
 *
 * `MapViewInner` created the map in one effect (gated on the async WebGL2
 * check) and wrote its overlays from *other* effects gated on the data. The
 * bus-marker effect opened with `if (!mapRef.current) return;` but listed
 * nothing about map readiness in its dependency array, so on the ordering
 * that actually happens in production —
 *
 * 1. first render: the WebGL check has not resolved, so no map exists;
 * 2. the REST snapshot resolves and `fix` is set → the marker effect runs →
 *    `mapRef.current` is still `null` → it returns;
 * 3. the WebGL check resolves → re-render → the map is created;
 * 4. `fix` never changes again → the marker effect never runs again
 *
 * — a trip whose only position came from the snapshot (a completed trip, a
 * reloaded `/tracking` page, any socket-quiet moment) had **no bus on the
 * map, permanently**. The stop markers survived only by luck, because
 * `mappedStops` usually arrives after the map exists.
 *
 * ### The rule
 *
 * A sync is either **applied** (there is a map and it has fired `load`) or it
 * is a **no-op that loses nothing**: this module holds no pending queue,
 * because the caller always passes the *current* data, so the next sync — the
 * one the `load` handler fires — writes everything that is true right now.
 * That is what makes the ordering above impossible to regress: readiness is
 * an input, not a hidden early return.
 *
 * ### Pure, ports injected
 *
 * No MapLibre import, no DOM: the map, the marker handles and every mutation
 * are injected (`OverlaySyncPorts`), exactly like `follow-camera-controller.ts`
 * takes a camera port. `overlay-sync.spec.ts` drives the whole thing with a
 * fake map under plain `node --test`.
 */

/** GeoJSON source ids owned by the map surface. */
export const ROUTE_SOURCE_ID = 'sbt-route';
export const TRAIL_SOURCE_ID = 'sbt-trail';
export const ACCURACY_SOURCE_ID = 'sbt-accuracy';

/** A stop, reduced to what the overlay writer needs. */
export interface OverlayStop {
  id: string;
  latitude: number;
  longitude: number;
  sequence_number: number;
  name: string;
  address?: string | null;
}

/** How a stop marker should read: plain, the route's next stop, or "yours". */
export type StopMarkerKind = 'plain' | 'next' | 'current';

/** A GeoJSON source handle, reduced to the one call the writer makes. */
export interface OverlaySourceHandle {
  setData(data: unknown): void;
}

/** Longitude, latitude — GeoJSON order, as MapLibre expects it. */
export type LngLat = [number, number];

/** Everything the overlays draw, as of this render. */
export interface OverlayData {
  fix: { latitude: number; longitude: number } | null;
  /** Planned line between stops, in sequence order. */
  routeCoordinates: readonly LngLat[];
  /** Driven-path breadcrumb, oldest first. */
  trailCoordinates: readonly LngLat[];
  /** Accuracy ring polygon, or `null` when there is nothing to draw. */
  accuracyFeature: unknown | null;
  stops: readonly OverlayStop[];
  highlightStopId: string | null;
  nextStopId: string | null;
}

/**
 * Every mutation the writer performs, injected.
 *
 * `TMap`, `TBus` and `TStop` stay generic so the real implementation can hand
 * back `maplibregl.Map` / `maplibregl.Marker` (plus the DOM element it has to
 * keep alongside) while this module stays engine-agnostic and testable.
 */
export interface OverlaySyncPorts<TMap, TBus, TStop> {
  /** `null` when the source does not exist yet (the style is still loading). */
  getSource(map: TMap, id: string): OverlaySourceHandle | null;
  createBusMarker(map: TMap, lngLat: LngLat): TBus;
  moveBusMarker(handle: TBus, lngLat: LngLat): void;
  removeBusMarker(handle: TBus): void;
  createStopMarker(map: TMap, stop: OverlayStop, kind: StopMarkerKind): TStop;
  updateStopMarker(handle: TStop, stop: OverlayStop, kind: StopMarkerKind): void;
  removeStopMarker(handle: TStop): void;
}

/** What one sync did — the caller reacts to `busMarkerCreated`. */
export interface OverlaySyncResult {
  /** False when there was no ready map: nothing was written, nothing lost. */
  applied: boolean;
  /** True on the sync that first put a bus on this map instance. */
  busMarkerCreated: boolean;
  stopMarkersCreated: number;
  stopMarkersRemoved: number;
  /** Source ids whose data was written this time. */
  sourcesUpdated: readonly string[];
}

export interface OverlaySyncInput<TMap> {
  /** The map instance, or `null` before it is constructed. */
  map: TMap | null;
  /** True only once the map has fired `load` and its sources exist. */
  ready: boolean;
  data: OverlayData;
}

export interface OverlaySync<TMap> {
  sync(input: OverlaySyncInput<TMap>): OverlaySyncResult;
  /** Map teardown: forget every handle (the engine removed them with it). */
  reset(): void;
  hasBusMarker(): boolean;
  stopMarkerCount(): number;
}

const NOT_APPLIED: OverlaySyncResult = {
  applied: false,
  busMarkerCreated: false,
  stopMarkersCreated: 0,
  stopMarkersRemoved: 0,
  sourcesUpdated: [],
};

function lineFeature(coordinates: readonly LngLat[]): unknown {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      // A one-point "line" is not a line; MapLibre would reject it.
      coordinates: coordinates.length >= 2 ? coordinates : [],
    },
  };
}

function stopKind(
  stop: OverlayStop,
  highlightStopId: string | null,
  nextStopId: string | null,
): StopMarkerKind {
  if (highlightStopId === stop.id) return 'current';
  if (nextStopId === stop.id) return 'next';
  return 'plain';
}

export function createOverlaySync<TMap, TBus, TStop>(
  ports: OverlaySyncPorts<TMap, TBus, TStop>,
): OverlaySync<TMap> {
  let boundMap: TMap | null = null;
  let busMarker: TBus | null = null;
  const stopMarkers = new Map<string, TStop>();

  function forget(): void {
    boundMap = null;
    busMarker = null;
    stopMarkers.clear();
  }

  return {
    sync({ map, ready, data }) {
      if (map === null || !ready) return NOT_APPLIED;

      // A different map instance means the previous one was removed and took
      // every marker with it; the handles we hold are dead references.
      if (boundMap !== null && boundMap !== map) forget();
      boundMap = map;

      const sourcesUpdated: string[] = [];
      const writeSource = (id: string, value: unknown): void => {
        const source = ports.getSource(map, id);
        if (source === null) return;
        source.setData(value);
        sourcesUpdated.push(id);
      };

      writeSource(ROUTE_SOURCE_ID, lineFeature(data.routeCoordinates));
      writeSource(TRAIL_SOURCE_ID, lineFeature(data.trailCoordinates));
      writeSource(ACCURACY_SOURCE_ID, {
        type: 'FeatureCollection',
        features: data.accuracyFeature === null ? [] : [data.accuracyFeature],
      });

      // ── Stop markers: diff by id so a highlight change never recreates the
      // whole set (and never recreates the popups).
      let stopMarkersCreated = 0;
      let stopMarkersRemoved = 0;
      const wanted = new Set(data.stops.map((stop) => stop.id));
      for (const [id, handle] of stopMarkers) {
        if (wanted.has(id)) continue;
        ports.removeStopMarker(handle);
        stopMarkers.delete(id);
        stopMarkersRemoved += 1;
      }
      for (const stop of data.stops) {
        const kind = stopKind(stop, data.highlightStopId, data.nextStopId);
        const existing = stopMarkers.get(stop.id);
        if (existing !== undefined) {
          ports.updateStopMarker(existing, stop, kind);
          continue;
        }
        stopMarkers.set(stop.id, ports.createStopMarker(map, stop, kind));
        stopMarkersCreated += 1;
      }

      // ── The bus marker: the whole point of this module.
      let busMarkerCreated = false;
      if (data.fix === null) {
        if (busMarker !== null) {
          ports.removeBusMarker(busMarker);
          busMarker = null;
        }
      } else {
        const lngLat: LngLat = [data.fix.longitude, data.fix.latitude];
        if (busMarker === null) {
          busMarker = ports.createBusMarker(map, lngLat);
          busMarkerCreated = true;
        } else {
          ports.moveBusMarker(busMarker, lngLat);
        }
      }

      return {
        applied: true,
        busMarkerCreated,
        stopMarkersCreated,
        stopMarkersRemoved,
        sourcesUpdated,
      };
    },

    reset: forget,
    hasBusMarker: () => busMarker !== null,
    stopMarkerCount: () => stopMarkers.size,
  };
}
