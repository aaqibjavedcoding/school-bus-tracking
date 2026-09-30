/**
 * The web live-map school-bus marker.
 *
 * ### One bus, one source
 *
 * The artwork itself is NOT defined here any more — it lives once in
 * `@school-bus-tracking/map-assets` (`BUS_MARKER_SVG` / `busBodyMarkup()` …),
 * and the same markup is rasterised into the mobile PNGs by
 * `scripts/make-bus-marker.mjs`. This module is only the *web wiring*: it inlines
 * that shared artwork into the document once and points every marker at it.
 *
 * ### Inlined once via `<defs>`/`<use>`, not parsed per marker
 *
 * A single hidden sprite `<svg>` (see `mapAssetSpriteMarkup`) is injected into
 * the document one time; it carries the gradients, the blur filter, the bus body
 * group and the ground-shadow group. Each marker is then built with real DOM
 * nodes (`createBusMarkerElement`) whose only SVG content is a tiny
 * `<use href="#…">` — so creating a marker never parses a full SVG string
 * through `innerHTML`, and N buses share one copy of the geometry.
 *
 * ### Geometry (unchanged)
 *
 * Nose-up, so heading 0° is north with no rotation applied; anchored at the
 * exact centre so rotating the rotor keeps the vehicle centre on the GPS
 * coordinate. The anchor maths comes straight from `BUS_MARKER_BOX`.
 *
 * ### Layering — shadow and halo never rotate
 *
 * `.bus-marker-rotor` is the only element `setBusIconHeading` turns. The ground
 * shadow and the pulse halo sit OUTSIDE it (siblings under `.bus-marker-anchor`)
 * so the light source and the halo stay put while the bus turns; the heading
 * cone lives INSIDE the rotor so it always points where the bus is going.
 */

import {
  BUS_MARKER_BOX,
  BUS_MARKER_SVG,
  BUS_MARKER_VIEWBOX,
  MAP_ASSET_IDS,
  busMarkerDefs,
  busBodyMarkup,
  busShadowMarkup,
  type BusMarkerVisualState,
} from '@school-bus-tracking/map-assets';

/** Footprint, re-exported from the shared source so nothing redefines it. */
export const BUS_MARKER_WIDTH = BUS_MARKER_BOX.width;
export const BUS_MARKER_HEIGHT = BUS_MARKER_BOX.height;

/** The full artwork string, re-exported so consumers/tests read the one source. */
export { BUS_MARKER_SVG };

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Id of the one hidden sprite `<svg>` injected into the document. */
export const MAP_ASSET_SPRITE_ID = 'sbt-map-asset-sprite';

/**
 * The hidden sprite markup: the shared `<defs>` plus the shadow and body groups,
 * inside a zero-size, off-screen, `aria-hidden` `<svg>`. Injected ONCE; every
 * marker `<use>`s the groups by id. This is the only place a full SVG string is
 * ever parsed on the web — a marker never is.
 */
export function mapAssetSpriteMarkup(): string {
  return `<svg id="${MAP_ASSET_SPRITE_ID}" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden;">${busMarkerDefs()}${busShadowMarkup()}${busBodyMarkup()}</svg>`;
}

/**
 * Ensure the shared sprite exists in the document exactly once. Cheap and
 * idempotent (guards on the id), and a no-op where there is no `document`
 * (SSR / `node --test`).
 */
export function ensureMapAssetSprite(doc?: Document): void {
  const target = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target || typeof target.getElementById !== 'function') return;
  if (target.getElementById(MAP_ASSET_SPRITE_ID)) return;
  const holder = target.createElement('div');
  // One-time parse of the sprite; markers below never touch innerHTML.
  holder.innerHTML = mapAssetSpriteMarkup();
  const sprite = holder.firstElementChild;
  if (sprite && target.body) target.body.appendChild(sprite);
}

/**
 * Plain-data marker geometry — no map runtime import, so the anchor maths stays
 * testable under `node --test`.
 */
export interface BusIconOptions {
  className: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

/**
 * The marker geometry, as plain data. Anchored at the exact centre so rotation
 * happens about the GPS coordinate; heading-independent so a turn never rebuilds
 * the icon.
 */
export function busIconOptions(): BusIconOptions {
  return {
    className: 'bus-marker',
    iconSize: [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT],
    iconAnchor: [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2],
    popupAnchor: [0, -BUS_MARKER_HEIGHT / 2],
  };
}

function useOf(doc: Document, id: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', BUS_MARKER_VIEWBOX);
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('aria-hidden', 'true');
  const use = doc.createElementNS(SVG_NS, 'use');
  // `href` is the modern attribute; `xlink:href` is kept for older engines.
  use.setAttribute('href', `#${id}`);
  use.setAttributeNS(XLINK_NS, 'xlink:href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

/**
 * Build a bus-marker element as real DOM nodes.
 *
 * Structure (only the rotor turns):
 *
 *     div.bus-marker
 *       div.bus-marker-anchor              ← centred on the GPS coordinate
 *         svg.bus-marker-shadow  → use #shadow   (static)
 *         div.bus-marker-halo                     (static pulse)
 *         div.bus-marker-rotor                    (rotated by setBusIconHeading)
 *           div.bus-marker-cone                   (heading cone, turns with bus)
 *           svg.bus-marker-bus → use #body
 *
 * The container is forced to zero size (MapLibre positions it; the graphic lives
 * in the absolutely-positioned anchor) so a turned bus is never clipped.
 */
export function createBusMarkerElement(doc?: Document): HTMLDivElement {
  const target = doc ?? document;
  ensureMapAssetSprite(target);

  const container = target.createElement('div');
  container.className = 'bus-marker';
  container.style.cssText = 'width:0;height:0;overflow:visible;';

  const anchor = target.createElement('div');
  anchor.className = 'bus-marker-anchor';

  const shadow = useOf(target, MAP_ASSET_IDS.busShadow);
  shadow.classList.add('bus-marker-shadow');

  const halo = target.createElement('div');
  halo.className = 'bus-marker-halo';

  const rotor = target.createElement('div');
  rotor.className = 'bus-marker-rotor';

  const cone = target.createElement('div');
  cone.className = 'bus-marker-cone';

  const bus = useOf(target, MAP_ASSET_IDS.busBody);
  bus.classList.add('bus-marker-bus');

  rotor.appendChild(cone);
  rotor.appendChild(bus);
  anchor.appendChild(shadow);
  anchor.appendChild(halo);
  anchor.appendChild(rotor);
  container.appendChild(anchor);
  return container;
}

/**
 * Apply a marker visual state to a marker element by writing data attributes the
 * stylesheet keys off (`globals.css`). Presentation only — no geometry changes,
 * so it never moves the marker off the coordinate.
 */
export function applyBusMarkerState(
  element: { dataset: DOMStringMap } | null | undefined,
  state: BusMarkerVisualState,
): void {
  if (!element || !element.dataset) return;
  element.dataset.tone = state.tone;
  element.dataset.pulse = state.pulse ? 'on' : 'off';
  element.dataset.cone = state.cone ? 'on' : 'off';
}

/** The minimum host this module needs — MapLibre Marker element or legacy host. */
export interface IconHost {
  getElement():
    { querySelector: (sel: string) => { style: { transform: string } } | null } | null | undefined;
}

/**
 * Rotate the icon's rotor in place. Mutating one `style.transform` keeps
 * rotation off React and off DOM construction; it is a compositor-only property.
 * Works with a direct element or a `getElement()` host, and is guarded for
 * `node --test`.
 */
export function setBusIconHeading(
  host:
    IconHost | { querySelector: (sel: string) => { style: { transform: string } } | null } | null,
  headingDeg: number | null,
): void {
  if (!host) return;

  let element:
    { querySelector: (sel: string) => { style: { transform: string } } | null } | null | undefined;

  if (typeof (host as { querySelector?: unknown }).querySelector === 'function') {
    element = host as { querySelector: (sel: string) => { style: { transform: string } } | null };
  } else if (typeof (host as IconHost).getElement === 'function') {
    try {
      element = (host as IconHost).getElement() as unknown as {
        querySelector: (sel: string) => { style: { transform: string } } | null;
      } | null;
    } catch {
      return;
    }
  } else {
    return;
  }

  if (!element) return;
  const rotor = element.querySelector('.bus-marker-rotor') as {
    style: { transform: string };
  } | null;
  if (!rotor) return;
  rotor.style.transform = `rotate(${headingDeg ?? 0}deg)`;
}
