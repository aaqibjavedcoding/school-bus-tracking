import type { FeatureCollection, Point } from 'geojson';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { driverStopMarkerKind } from '../crew/crew-map-presentation.ts';

/**
 * The stops as ONE map layer — the GeoJSON the single `sbt-stops` source is
 * fed, pure and React-free.
 *
 * Until this module the stops were N `ViewAnnotation`s (one per stop, each
 * carrying its own React subtree). On Android every ViewAnnotation is
 * rasterised into an offscreen bitmap, so a 30-stop route paid 30 bitmap
 * captures plus 30 native view trees on every mount — and again whenever the
 * annotation z-order forced a refresh. One GeoJSON source with a circle layer
 * (the dot) and a symbol layer (the always-visible label) is one upload, drawn
 * by the GPU, and the "which stop is next" highlight becomes a data-driven
 * paint property instead of a re-render.
 *
 * ### What each feature carries
 *
 * - `kind` — `'next'` for the stop the screen's `deriveTripProgressForTrip`
 *   derivation says is next (decided by `crew-map-presentation`'s
 *   `driverStopMarkerKind`, so the layer can never develop a second opinion
 *   about progress), `'plain'` for every other stop. Drives the data-driven
 *   paint: radius, colour, stroke.
 * - `label` — the already-localised `"{number}. {name}"` reading line (the
 *   shared `map.stopLabel` template, the web map's `.stop-marker-label`
 *   twin), with the `NEXT` badge prefix on the next stop. Localisation is the
 *   caller's job (`labelFor`), which is why the locale must be in the calling
 *   memo's dependencies: a language switch has to rebuild this collection or
 *   the labels stay in the old language.
 * - `id`/`sequence` — identity for future hit-testing and diagnostics.
 *
 * `null` when there is nothing to draw, so the surface never mounts a source
 * for an empty collection.
 */

/** The kind of a stop's rendering, decided outside this module. */
export type StopLayerKind = 'plain' | 'next';

/** A located stop — the subset of `StopResponse` the layer needs. */
export type StopLayerStop = StopResponse & { latitude: number; longitude: number };

/** The properties every stop feature carries (see the module doc). */
export interface StopLayerProperties {
  id: string;
  label: string;
  kind: StopLayerKind;
  sequence: number;
}

/** Resolves the display label for one stop, already localised. */
export type StopLabelResolver = (stop: StopLayerStop, kind: StopLayerKind) => string;

/**
 * Builds the one FeatureCollection the stop layers read, or `null` when there
 * are no located stops.
 */
export function stopsLayerCollection(
  stops: readonly StopLayerStop[],
  nextStopId: string | null | undefined,
  labelFor: StopLabelResolver,
): FeatureCollection<Point> | null {
  if (stops.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: stops.map((stop) => {
      const kind = driverStopMarkerKind(stop.id, nextStopId);
      const properties: StopLayerProperties = {
        id: stop.id,
        label: labelFor(stop, kind),
        kind,
        sequence: stop.sequence_number,
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

/**
 * The stop dot's radius in pixels, by kind — the data-driven paint value for
 * `circle-radius`. Stated here so the two layers (dot + label) and any spec
 * read one table: the next stop is the near-double-size amber pin, every
 * other stop the small slate dot, exactly as the old per-stop annotations
 * drew them.
 */
export const STOP_LAYER_RADIUS_PX: Record<StopLayerKind, number> = {
  plain: 5.5,
  next: 9,
};
