import { BUS_3D_LAYER_ID } from './bus-3d.ts';

/**
 * POI tap sheet policy (web, Session 6 step 2).
 *
 * Tapping a POI icon on the map opens a small sheet with the place's name and
 * category. Two properties make it free:
 *
 * - **No network, no new data source.** The answer comes from the vector-tile
 *   feature the map has *already rendered*: `MapViewInner`'s click handler
 *   calls `map.queryRenderedFeatures(point)` and hands the hits here. The POI
 *   layer of the shipped kidbus style (OpenMapTiles `poi`) carries `name` and
 *   `class` in every feature, which is everything the sheet shows.
 * - **Stops win.** The map's own tap targets — the stop dots/numbers/labels
 *   and the bus (the 3D mesh layer, and the flat DOM marker in 2D) — take
 *   absolute precedence over any POI underneath them: when a tap hits both,
 *   the stop's existing popup opens and the sheet does not. The bus keeps its
 *   status popup for the same reason. That precedence is decided here, as a
 *   pure function over the hit list, not by event-handler ordering or DOM
 *   z-index, so it can be pinned by `poi-sheet.spec.ts` under `node --test`.
 *
 * No MapLibre import, no DOM: the component translates engine objects into
 * the plain `TappedFeature` shape below.
 */

/** The POI layer of the shipped kidbus styles (day and night). */
export const POI_LAYER_ID = 'poi';

/** The stop layers, in their drawn order (dot → number → name label). */
export const STOP_TAP_LAYER_IDS = [
  'sbt-stops-dot',
  'sbt-stops-number',
  'sbt-stops-label',
] as const;

/**
 * Synthetic layer id for a tap that landed on the flat 2D bus marker. The 2D
 * marker is a DOM element, not a style layer, so `queryRenderedFeatures` can
 * never return it; the click handler detects a `.maplibregl-marker` hit from
 * `originalEvent.target` and pushes this entry so *all* precedence (including
 * "the bus beats a POI behind it") stays inside the pure decision below.
 */
export const BUS_DOM_MARKER_LAYER_ID = 'sbt-bus-dom-marker';

/** Every layer the tap handler should query, in precedence-relevant order. */
export function mapTapQueryLayerIds(): string[] {
  return [...STOP_TAP_LAYER_IDS, BUS_3D_LAYER_ID, POI_LAYER_ID];
}

/** One rendered feature under the tap, reduced to what the decision needs. */
export interface TappedFeature {
  layerId: string;
  properties?: Record<string, unknown> | null;
}

/** What the sheet displays. `name` is null for an unnamed place. */
export interface PoiTapInfo {
  name: string | null;
  /** Humanised OpenMapTiles class, e.g. `place_of_worship` → "Place of worship". */
  category: string;
  /** The raw tile attribute, for tests/debugging (`school`, `fuel`, …). */
  categoryRaw: string;
}

export type MapTapOutcome =
  /** A stop or the bus: their own popup owns this tap; the sheet stays shut. */
  | { type: 'app-feature' }
  /** A POI: open the sheet with these details. */
  | { type: 'poi'; poi: PoiTapInfo }
  /** Plain base map: dismiss whatever is open. */
  | { type: 'empty' };

const APP_LAYER_IDS: ReadonlySet<string> = new Set([
  ...STOP_TAP_LAYER_IDS,
  BUS_3D_LAYER_ID,
  BUS_DOM_MARKER_LAYER_ID,
]);

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `place_of_worship` → "Place of worship"; anything unusable → null. */
export function humanisePoiClass(raw: unknown): string | null {
  const text = nonEmptyString(raw);
  if (!text) return null;
  const words = text
    .split('_')
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return null;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * Reads the sheet content from an already-rendered POI feature. The OpenMap-
 * Tiles `poi` source-layer carries `name` (local-language), `name:en` and
 * `class`. Returns `null` when the feature has neither a name nor a usable
 * class — a featureless icon must not open an empty sheet.
 */
export function poiInfoFromFeature(feature: TappedFeature): PoiTapInfo | null {
  const properties = feature.properties ?? {};
  const categoryRaw = nonEmptyString(properties.class);
  const category = humanisePoiClass(categoryRaw);
  if (!categoryRaw || !category) return null;
  const name = nonEmptyString(properties.name) ?? nonEmptyString(properties['name:en']);
  return { name, category, categoryRaw };
}

/**
 * Who owns a tap, given every rendered feature under the tap point (and the
 * synthetic DOM-marker entry, when the tap hit the 2D bus).
 *
 * Precedence is absolute and order-independent: a stop or the bus **anywhere**
 * in the hit list beats every POI everywhere else. Only when no app feature
 * was hit does the first usable POI feature open the sheet.
 */
export function resolveMapTap(features: readonly TappedFeature[]): MapTapOutcome {
  const hitAppFeature = features.some((feature) => APP_LAYER_IDS.has(feature.layerId));
  if (hitAppFeature) return { type: 'app-feature' };

  for (const feature of features) {
    if (feature.layerId !== POI_LAYER_ID) continue;
    const poi = poiInfoFromFeature(feature);
    if (poi) return { type: 'poi', poi };
  }
  return { type: 'empty' };
}
