import type { FeatureCollection, Point } from 'geojson';
import type { StopResponse } from '@school-bus-tracking/shared-types';

/**
 * The stops as ONE map layer — the GeoJSON the single `sbt-stops` source is
 * fed (web twin of the mobile `stop-layer.ts`).
 *
 * The stops used to be N DOM markers (`createStopMarkerElement`), each an
 * element MapLibre had to position and repaint on every camera frame. One
 * GeoJSON source with a circle layer (the dot), a symbol layer for the
 * sequence number inside it and a symbol layer for the always-visible name
 * label is one upload drawn by the GPU, and the highlight (next stop, the
 * parent's home stop) becomes a data-driven paint property instead of a
 * class-swap on N elements. Popups move to a layer click handler.
 *
 * ### The kinds
 *
 * - `'next'` — the route's next stop (amber, enlarged): the stop the bus is
 *   driving towards.
 * - `'current'` — the parent pages' highlighted home stop (green).
 * - `'plain'` — every other stop (blue).
 */

export type StopLayerKind = 'plain' | 'next' | 'current';

/** A located stop — the subset of `StopResponse` the layer needs. */
export type StopLayerStop = StopResponse & { latitude: number; longitude: number };

/** The properties every stop feature carries. */
export interface StopLayerProperties {
  id: string;
  /** The always-visible label: `"{sequence}. {name}"`. */
  label: string;
  kind: StopLayerKind;
  sequence: number;
  /** Raw values for the click popup — escaped where the popup is built. */
  name: string;
  address: string | null;
}

/** Resolves the kind of one stop from the two independent highlight props. */
export function stopLayerKind(
  stopId: string,
  highlightStopId: string | null | undefined,
  nextStopId: string | null | undefined,
): StopLayerKind {
  if (highlightStopId === stopId) return 'current';
  if (nextStopId === stopId) return 'next';
  return 'plain';
}

/**
 * Builds the one FeatureCollection the stop layers read, or `null` when there
 * are no located stops (so the source is never fed an empty collection it
 * would then have to be torn down for).
 */
export function stopsLayerCollection(
  stops: readonly StopLayerStop[],
  highlightStopId: string | null | undefined,
  nextStopId: string | null | undefined,
): FeatureCollection<Point> | null {
  if (stops.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: stops.map((stop) => {
      const kind = stopLayerKind(stop.id, highlightStopId, nextStopId);
      const properties: StopLayerProperties = {
        id: stop.id,
        label: `${stop.sequence_number}. ${stop.name}`,
        kind,
        sequence: stop.sequence_number,
        name: stop.name,
        address: stop.address ?? null,
      };
      return {
        type: 'Feature' as const,
        properties,
        geometry: {
          type: 'Point' as const,
          coordinates: [stop.longitude, stop.latitude],
        },
      };
    }),
  };
}
