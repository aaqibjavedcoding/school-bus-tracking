import type { DivIconOptions } from 'leaflet';

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
 * The SVG is inlined into a Leaflet `divIcon`, so there is no tile request, no
 * CDN, no `img-src` entry to add to the CSP allowlist in
 * `web/src/lib/security-headers.js`, and nothing paid.
 *
 * ### Geometry
 *
 * Nose-up, so heading 0° is north with no rotation applied, and symmetric about
 * its own centre so rotating it keeps the vehicle centre on the GPS coordinate.
 * `iconAnchor` is the exact centre for the same reason.
 */

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
 * The `divIcon` options, as plain data.
 *
 * Kept free of the `leaflet` runtime import on purpose: `leaflet` dereferences
 * `window` at module scope, so anything that imports it cannot be loaded under
 * `node --test`. Splitting the numbers out means the marker's geometry — the
 * part that is easy to break by editing the SVG — is directly testable, and the
 * one-line `L.divIcon(...)` wrapper stays in `MapViewInner.tsx` where Leaflet is
 * already loaded.
 *
 * Deliberately heading-independent: the rotation is applied to the inner
 * `.bus-marker-rotor` element by the animation loop, so a heading change never
 * rebuilds the icon or its DOM subtree. The previous implementation recreated
 * the `divIcon` on every heading value, which threw away and re-created the
 * element twenty times a second.
 */
export function busIconOptions(): DivIconOptions {
  return {
    className: 'bus-marker',
    html: `<div class="bus-marker-rotor">${BUS_MARKER_SVG}</div>`,
    iconSize: [BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT],
    iconAnchor: [BUS_MARKER_WIDTH / 2, BUS_MARKER_HEIGHT / 2],
    popupAnchor: [0, -BUS_MARKER_HEIGHT / 2],
  };
}

/** The minimum of `L.Marker` this module needs — `L.Marker` satisfies it. */
export interface IconHost {
  getElement(): HTMLElement | undefined | null;
}

/**
 * Rotates the icon's inner element in place.
 *
 * Mutating one `style.transform` is what keeps rotation off React and off the
 * DOM-construction path; it is a compositor-only property, so the browser does
 * not relayout for it.
 */
export function setBusIconHeading(marker: IconHost | null, headingDeg: number | null): void {
  const element = marker?.getElement();
  if (!element) return;
  const rotor = element.querySelector<HTMLElement>('.bus-marker-rotor');
  if (!rotor) return;
  rotor.style.transform = `rotate(${headingDeg ?? 0}deg)`;
}
