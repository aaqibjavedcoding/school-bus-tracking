/**
 * `@school-bus-tracking/map-assets` — the ONE source of truth for the live-map
 * marker artwork.
 *
 * ### Why this package exists
 *
 * The bus used to be drawn twice: `web/src/features/map/bus-marker-icon.ts`
 * built it out of five flat `<rect>`s, and `mobile` shipped a wholly different
 * 1.6 MB AI-generated PNG master cut out by a Python script. Comments on both
 * sides claimed "one bus on both platforms" while the two artworks visibly
 * disagreed. This package ends that: the geometry below is the only place a bus
 * is defined, the web map inlines it as SVG, and the mobile PNGs are rasterised
 * FROM this same markup by `scripts/make-bus-marker.mjs`. Change the bus here
 * and both platforms change together — there is nowhere else to change it.
 *
 * ### What is drawn
 *
 * A three-quarter isometric school bus, **nose-up at heading 0°** so a heading
 * reading means something and no rotation is applied at north. Depth comes from
 * a darker extruded chassis behind the body, an amber body gradient, a raised
 * roof, glass with a specular highlight, dark wheel wells and headlights — a
 * bus that reads as a *vehicle* at 26 px, not a coloured speck.
 *
 * The soft elliptical **ground shadow is a separate export** (`BUS_SHADOW_SVG`
 * / the `#${MAP_ASSET_IDS.busShadow}` symbol) precisely so the renderers can
 * place it OUTSIDE the element they rotate — a shadow that spun with the bus
 * would look like the light source orbits the vehicle. `BUS_MARKER_SVG` (shadow
 * + body, one standalone file) exists for previews and as the canonical whole;
 * the renderers compose the two layers themselves.
 *
 * ### No runtime weight
 *
 * Pure strings and numbers. No dependency, no DOM, no `maplibre`, no network
 * reference (every `url(#…)` is a local paint-server id, never a fetch), so it
 * is safe to import from the web bundle, and cheap for the Node rasteriser to
 * read at build time. Nothing here draws with a canvas or a 3-D engine — there
 * is deliberately no `three.js` / `deck.gl`.
 */

/** Marker footprint, in CSS px (web) / dp (mobile). */
export const BUS_MARKER_WIDTH = 26;
export const BUS_MARKER_HEIGHT = 42;

/**
 * The square the marker needs room to **turn inside**: the diagonal of the
 * footprint, rounded up. A 26 × 42 bus rotated 45° occupies ~48 × 48; sizing the
 * rotation host to this square is what keeps a diagonal heading from clipping the
 * bus to its own unrotated corners. Web and mobile both anchor at the box centre,
 * so rotation happens about the GPS coordinate.
 */
export const BUS_MARKER_ROTATION_BOX = Math.ceil(Math.hypot(BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT));

/**
 * Geometry constants as one object, so a consumer takes the whole box rather
 * than re-deriving the anchor maths. `web/src/features/map/bus-marker-icon.ts`
 * builds its `iconSize` / `iconAnchor` / `popupAnchor` straight off this.
 */
export const BUS_MARKER_BOX = {
  width: BUS_MARKER_WIDTH,
  height: BUS_MARKER_HEIGHT,
  rotationBox: BUS_MARKER_ROTATION_BOX,
} as const;

/**
 * The internal drawing grid. Larger than the on-screen box so the artwork keeps
 * crisp detail when rasterised at @2x / @3x; the aspect ratio is exactly the
 * marker box (130 / 210 = 26 / 42), so nothing is stretched.
 */
export const BUS_MARKER_VIEWBOX_WIDTH = 130;
export const BUS_MARKER_VIEWBOX_HEIGHT = 210;
export const BUS_MARKER_VIEWBOX = `0 0 ${BUS_MARKER_VIEWBOX_WIDTH} ${BUS_MARKER_VIEWBOX_HEIGHT}`;

/**
 * The ids the SVG paint-servers and symbols are published under. Exported so the
 * web renderer can `<use href="#…">` them and so nothing hard-codes a string
 * that a later edit here would silently break.
 */
export const MAP_ASSET_IDS = {
  busBody: 'sbt-bus-body',
  busShadow: 'sbt-bus-shadow',
  busFill: 'sbt-bus-fill',
  busRoof: 'sbt-bus-roof',
  busGlass: 'sbt-bus-glass',
  busShadowBlur: 'sbt-bus-shadow-blur',
  stopPin: 'sbt-stop-pin',
  stopFill: 'sbt-stop-fill',
} as const;

/** School-bus palette, kept in step with `@school-bus-tracking/design-tokens`. */
const OUTLINE = '#0f172a';

/**
 * The paint-servers and the blur filter, as one `<defs>` block. Local ids only
 * — `url(#…)` here is a paint-server reference, not a network fetch.
 */
export function busMarkerDefs(): string {
  return `<defs>
    <linearGradient id="${MAP_ASSET_IDS.busFill}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fcd34d"/>
      <stop offset="0.55" stop-color="#f59e0b"/>
      <stop offset="1" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="${MAP_ASSET_IDS.busRoof}" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#fef3c7"/>
      <stop offset="0.6" stop-color="#fbbf24"/>
      <stop offset="1" stop-color="#d97706"/>
    </linearGradient>
    <linearGradient id="${MAP_ASSET_IDS.busGlass}" x1="0.15" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#e0f2fe"/>
      <stop offset="1" stop-color="#2563eb"/>
    </linearGradient>
    <filter id="${MAP_ASSET_IDS.busShadowBlur}" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4.5"/>
    </filter>
  </defs>`;
}

/**
 * The rotating bus, nose-up. NO shadow (the shadow must not turn) and NO
 * `<defs>` (the caller provides them once). Symmetric enough about the vertical
 * centre line that rotating about the box centre keeps the vehicle centred on
 * the coordinate.
 */
export function busBodyMarkup(): string {
  return `<g id="${MAP_ASSET_IDS.busBody}">
    <!-- extruded chassis behind the body, offset down-right for depth -->
    <rect x="23" y="22" width="96" height="182" rx="30" fill="#5c2408"/>
    <!-- wheel wells poking out of the body rim (front + rear, both sides) -->
    <rect x="11" y="62" width="13" height="30" rx="6.5" fill="#0b1120"/>
    <rect x="106" y="62" width="13" height="30" rx="6.5" fill="#0b1120"/>
    <rect x="11" y="156" width="13" height="30" rx="6.5" fill="#0b1120"/>
    <rect x="106" y="156" width="13" height="30" rx="6.5" fill="#0b1120"/>
    <!-- main body -->
    <rect x="17" y="14" width="96" height="182" rx="30" fill="url(#${MAP_ASSET_IDS.busFill})" stroke="${OUTLINE}" stroke-width="3"/>
    <!-- raised roof -->
    <rect x="27" y="26" width="76" height="158" rx="24" fill="url(#${MAP_ASSET_IDS.busRoof})"/>
    <!-- windscreen (nose) -->
    <rect x="34" y="34" width="62" height="32" rx="13" fill="url(#${MAP_ASSET_IDS.busGlass})"/>
    <!-- specular highlight raked across the windscreen -->
    <path d="M40 60 L62 35 L72 35 L50 62 Z" fill="#ffffff" opacity="0.5"/>
    <!-- side windows -->
    <rect x="31" y="78" width="14" height="74" rx="7" fill="url(#${MAP_ASSET_IDS.busGlass})" opacity="0.82"/>
    <rect x="85" y="78" width="14" height="74" rx="7" fill="url(#${MAP_ASSET_IDS.busGlass})" opacity="0.82"/>
    <!-- rear window -->
    <rect x="38" y="164" width="54" height="16" rx="8" fill="#1e3a5f" opacity="0.72"/>
    <!-- roof line -->
    <rect x="32" y="150" width="66" height="3.5" rx="1.75" fill="#5c2408" opacity="0.5"/>
    <!-- headlights at the nose corners -->
    <circle cx="33" cy="22" r="3.6" fill="#fff7cc"/>
    <circle cx="97" cy="22" r="3.6" fill="#fff7cc"/>
  </g>`;
}

/**
 * The soft elliptical ground shadow, as a symbol group. Rendered OUTSIDE the
 * rotating group by every consumer, so the light source stays put while the bus
 * turns. Nudged down-right of the body centre to match the top-left key light.
 */
export function busShadowMarkup(): string {
  return `<g id="${MAP_ASSET_IDS.busShadow}">
    <ellipse cx="70" cy="196" rx="52" ry="12" fill="${OUTLINE}" opacity="0.26" filter="url(#${MAP_ASSET_IDS.busShadowBlur})"/>
  </g>`;
}

/**
 * The complete, standalone bus artwork — ground shadow THEN body, one file.
 * This is the canonical whole (used for previews / documentation and as the
 * thing the acceptance grep points at). The renderers do not inline this
 * verbatim: the web map splits shadow and body into separate layers so only the
 * body rotates, and the mobile rasteriser takes the body alone (see
 * `BUS_BODY_SVG`) and paints its own static shadow.
 */
export const BUS_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BUS_MARKER_VIEWBOX}" width="${BUS_MARKER_WIDTH}" height="${BUS_MARKER_HEIGHT}" role="img" focusable="false">${busMarkerDefs()}${busShadowMarkup()}${busBodyMarkup()}</svg>`;

/**
 * The rotating bus body ONLY, as a standalone SVG. This is exactly what the
 * mobile rasteriser turns into `bus-marker.png` @1x/@2x/@3x — no shadow, because
 * the PNG is rotated by the marker view and a baked-in shadow would spin.
 */
export const BUS_BODY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BUS_MARKER_VIEWBOX}" width="${BUS_MARKER_WIDTH}" height="${BUS_MARKER_HEIGHT}" role="img" focusable="false">${busMarkerDefs()}${busBodyMarkup()}</svg>`;

/**
 * The shadow ONLY, as a standalone SVG — the web map draws this in an
 * un-rotated layer beneath the rotor.
 */
export const BUS_SHADOW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BUS_MARKER_VIEWBOX}" width="${BUS_MARKER_WIDTH}" height="${BUS_MARKER_HEIGHT}" aria-hidden="true" focusable="false">${busMarkerDefs()}${busShadowMarkup()}</svg>`;

/* ------------------------------------------------------------------ *
 * Stop marker — a deliberately different species from the bus.
 * ------------------------------------------------------------------ */

export const STOP_MARKER_WIDTH = 28;
export const STOP_MARKER_HEIGHT = 38;
export const STOP_MARKER_VIEWBOX = '0 0 60 82';
export const STOP_MARKER_BOX = {
  width: STOP_MARKER_WIDTH,
  height: STOP_MARKER_HEIGHT,
} as const;

/**
 * A soft-lifted slate pin with a light ring — a teardrop that floats over its
 * own ground shadow, so a stop can never be mistaken for the amber, rotating
 * bus at a glance or in a screenshot. Slate, not amber; a pin, not a box; and it
 * never rotates.
 */
export function stopMarkerMarkup(): string {
  return `<defs>
    <linearGradient id="${MAP_ASSET_IDS.stopFill}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#94a3b8"/>
      <stop offset="1" stop-color="#334155"/>
    </linearGradient>
  </defs>
  <g id="${MAP_ASSET_IDS.stopPin}">
    <ellipse cx="30" cy="74" rx="13" ry="4" fill="${OUTLINE}" opacity="0.22"/>
    <path d="M30 6 C17 6 7 16 7 29 C7 45 30 68 30 68 C30 68 53 45 53 29 C53 16 43 6 30 6 Z" fill="url(#${MAP_ASSET_IDS.stopFill})" stroke="${OUTLINE}" stroke-width="2.5"/>
    <circle cx="30" cy="28" r="9.5" fill="#f8fafc"/>
    <circle cx="30" cy="28" r="9.5" fill="none" stroke="#334155" stroke-width="2.5"/>
  </g>`;
}

/** The complete, standalone stop pin artwork. */
export const STOP_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${STOP_MARKER_VIEWBOX}" width="${STOP_MARKER_WIDTH}" height="${STOP_MARKER_HEIGHT}" role="img" focusable="false">${stopMarkerMarkup()}</svg>`;

/* ------------------------------------------------------------------ *
 * Marker visual state — one pure verdict, shared by both platforms.
 * ------------------------------------------------------------------ */

/**
 * The speed at which a device-reported course stops being noise. Mirrors
 * `MOTION_THRESHOLDS.headingMinSpeedKmh` in `bus-motion.ts` — below this the bus
 * is treated as stopped and no heading cone is drawn, exactly the gate the
 * motion machine already applies to the heading itself.
 */
export const HEADING_GATE_KMH = 3;

export interface BusMarkerStateInput {
  /** The fix is inside the live window (not last-known / stale). */
  live: boolean;
  /** The OS / browser reduce-motion preference. */
  reducedMotion: boolean;
  /** Current ground speed in km/h, or `null` when unknown. */
  speedKmh: number | null;
  /** A usable heading has been established. */
  hasHeading: boolean;
}

export interface BusMarkerVisualState {
  /** `'live'` draws full colour; `'stale'` desaturates. */
  tone: 'live' | 'stale';
  /** Whether the gentle pulse halo animates. */
  pulse: boolean;
  /** Whether the heading cone is drawn ahead of the bus. */
  cone: boolean;
}

/**
 * The single decision behind every marker state, so web and mobile can never
 * disagree about the same bus:
 *
 * - **live + moving** → full colour, pulse halo, heading cone;
 * - **live + stopped** → full colour, pulse halo, no cone;
 * - **last known / stale** → desaturated, no pulse, no cone;
 * - **reduced motion** → the pulse is suppressed (the cone is a static shape,
 *   not an animation, so it stays).
 */
export function resolveBusMarkerVisualState(input: BusMarkerStateInput): BusMarkerVisualState {
  const moving =
    input.hasHeading &&
    input.speedKmh !== null &&
    Number.isFinite(input.speedKmh) &&
    input.speedKmh >= HEADING_GATE_KMH;

  return {
    tone: input.live ? 'live' : 'stale',
    pulse: input.live && !input.reducedMotion,
    cone: input.live && moving,
  };
}
