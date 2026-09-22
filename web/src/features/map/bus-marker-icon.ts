/**
 * The top-view school-bus marker, drawn as inline SVG.
 *
 * ### Why SVG and not the emoji it replaces
 *
 * The previous marker was `🚌` inside a rotated `div`. The glyph is a
 * three-quarter front view, so `transform: rotate(340deg)` spun a picture of a
 * bus that was not pointing anywhere — the rotation was decoration, not a
 * heading. A top-view silhouette is the only shape for which "rotated 90°"
 * means "facing east".
 *
 * It also matches the native marker: `mobile/src/features/map/BusMarkerGraphic.tsx`
 * draws the same body, windscreen, window strips and darker rear with React
 * Native views, so a parent switching between the app and the console sees one
 * bus, not two.
 *
 * ### No network, no asset pack
 *
 * The SVG is inlined into a MapLibre `Marker` element, so there is no tile
 * request, no CDN, no extra `img-src` entry, and nothing paid.
 *
 * ### Geometry
 *
 * Nose-up, so heading 0° is north with no rotation applied, and symmetric about
 * its own centre so rotating it keeps the vehicle centre on the GPS coordinate.
 * Anchor is the exact centre for the same reason.
 */

/**
 * Plain-data replacement for Leaflet's DivIconOptions — no leaflet dependency.
 * Keeps the marker geometry testable under `node --test`.
 */
export interface BusIconOptions {
  className: string;
  html: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
}

export const BUS_MARKER_WIDTH = 26;
export const BUS_MARKER_HEIGHT = 42;

/** School-bus amber / near-black outline, straight from the design tokens. */
const BODY_FILL = '#f59e0b';
const OUTLINE = '#0f172a';
const GLASS = '#f8fafc';
const REAR = '#92400e';

export const BUS_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BUS_MARKER_WIDTH} ${BUS_MARKER_HEIGHT}" width="${BUS_MARKER_WIDTH}" height="${BUS_MARKER_HEIGHT}" role="img" focusable="false">
  <rect x="1.5" y="1.5" width="23" height="39" rx="6" fill="${BODY_FILL}" stroke="${OUTLINE}" stroke-width="2.5"/>
  <rect x="6" y="5" width="14" height="5" rx="2" fill="${GLASS}" opacity="0.95"/>
  <rect x="4.75" y="13" width="4.5" height="19" rx="2" fill="${GLASS}" opacity="0.8"/>
  <rect x="16.75" y="13" width="4.5" height="19" rx="2" fill="${GLASS}" opacity="0.8"/>
  <rect x="6" y="34.5" width="14" height="3.5" rx="1.75" fill="${REAR}"/>
</svg>`;

/**
 * The marker options, as plain data.
 *
 * Kept free of any map runtime import on purpose so geometry is directly
 * testable. Deliberately heading-independent: rotation is applied to the inner
 * `.bus-marker-rotor` element by the animation loop, so a heading change never
 * rebuilds the icon DOM.
 */
export function busIconOptions(): BusIconOptions {
  return {
    className: 'bus-marker',
    // `bus-marker-anchor` centres the graphic on the marker's origin; the rotor
    // inside it is what the heading is written to. Splitting the two is what lets
    // the marker box be zero-sized (so a turned bus is never clipped) without
    // losing the centring. See `globals.css`.
    html: `<div class="bus-marker-anchor"><div class="bus-marker-rotor">${BUS_MARKER_SVG}</div></div>`,
    iconSize: [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT],
    iconAnchor: [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2],
    popupAnchor: [0, -BUS_MARKER_HEIGHT / 2],
  };
}

/** The minimum host this module needs — MapLibre Marker element or legacy host. */
export interface IconHost {
  getElement():
    { querySelector: (sel: string) => { style: { transform: string } } | null } | null | undefined;
}

/**
 * Rotates the icon's inner element in place.
 *
 * Mutating one `style.transform` keeps rotation off React and off the DOM
 * construction path; it is a compositor-only property. Works with both a direct
 * HTMLElement (MapLibre marker element) and a host exposing `getElement()` (legacy
 * Leaflet marker). Guarded for `node --test` where `HTMLElement` may not exist.
 */
export function setBusIconHeading(
  host:
    IconHost | { querySelector: (sel: string) => { style: { transform: string } } | null } | null,
  headingDeg: number | null,
): void {
  if (!host) return;

  let element:
    { querySelector: (sel: string) => { style: { transform: string } } | null } | null | undefined;

  // Direct element (MapLibre marker element or fake DOM in tests)
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
