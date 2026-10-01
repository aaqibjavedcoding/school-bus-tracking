export * from './map-camera';

/**
 * Shared map artwork.
 *
 * There is intentionally one school-bus drawing in this workspace. Web keeps
 * its symbols in a document-level SVG `<defs>` and every marker references it
 * with `<use>`; the native build script rasterises the same source into the
 * small density-specific PNGs Metro bundles. Neither consumer redraws a bus.
 */

/**
 * The visible marker footprint is intentionally unchanged from the legacy
 * sprite. The coordinate is the exact centre of this rectangle at every
 * heading; `rotationBox` is the surrounding square that prevents diagonal
 * clipping on React Native / MapLibre annotation snapshots.
 */
export const BUS_MARKER_BOX = {
  width: 26,
  height: 42,
  rotationBox: Math.ceil(Math.hypot(26, 42)),
  viewBoxWidth: 62,
  viewBoxHeight: 100,
} as const;

export const BUS_MARKER_ART_ID = 'sbt-bus-marker-art';
export const BUS_MARKER_SHADOW_ID = 'sbt-bus-marker-shadow';

/**
 * Shared `<defs>` payload. This is mounted exactly once on the web map.
 *
 * ### Why the bus is drawn from directly above
 *
 * The marker rotates with the reported heading, and the ride-hailing
 * convention every user already knows (Ola / Uber / Maps) is a **top-down
 * (roof view) vehicle**: a plan view is the only projection that stays honest
 * at all 360 headings, because it has no fixed horizon to fight with. The
 * previous 3/4 "lifted coach" read as a blocky square once it was squeezed
 * into the 26 × 42 dp box and tilted sideways — a perspective drawing that is
 * rotated is a drawing lit and foreshortened from the wrong direction.
 *
 * The drawing therefore sits inside a 62 × 100 viewBox (the exact aspect of
 * the 26 × 42 dp footprint), the nose points to **−y, so heading 0 is north**,
 * and the vehicle's visual centre is the viewBox centre (31, 50) — that is the
 * GPS coordinate at every heading.
 *
 * ### What survives at 26 dp
 *
 * Only shapes bigger than roughly 4 viewBox units (≈1.7 px at @1x) read, so
 * the detail budget is spent on the four cues that make a top-down shape a
 * *school bus going that way*:
 *
 *   1. the long amber capsule with a heavy dark outline (vehicle, high
 *      contrast against any tile palette);
 *   2. a wide dark windscreen across the nose and a small rear window — the
 *      front/back asymmetry that makes the heading readable;
 *   3. tyres and the driver's mirrors peeking outside the silhouette;
 *   4. a lighter raised roof panel with two hatches, which is what tells the
 *      eye it is looking down at a tall box rather than at a flat lozenge.
 *
 * The contact shadow is baked into the rotating art on purpose: a top-down
 * vehicle's shadow has the vehicle's shape, so it must turn with it. The
 * static, unrotated ambient disc below is what does *not* turn.
 */
export const BUS_MARKER_DEFS_SVG = `
  <linearGradient id="sbt-bus-marker-body" x1="0.1" y1="0" x2="0.92" y2="1">
    <stop offset="0" stop-color="#ffd468"/>
    <stop offset="0.45" stop-color="#f9ae10"/>
    <stop offset="1" stop-color="#d87c06"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-roof" x1="0.1" y1="0" x2="0.95" y2="1">
    <stop offset="0" stop-color="#ffeaa8"/>
    <stop offset="0.55" stop-color="#ffd163"/>
    <stop offset="1" stop-color="#f0a715"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-glass" x1="0.1" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="#e3f3fc"/>
    <stop offset="0.4" stop-color="#7fb3d1"/>
    <stop offset="1" stop-color="#22465f"/>
  </linearGradient>
  <filter id="sbt-bus-marker-shadow-blur" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur stdDeviation="3"/>
  </filter>
  <filter id="sbt-bus-marker-contact-blur" x="-35%" y="-25%" width="170%" height="150%">
    <feGaussianBlur stdDeviation="1.7"/>
  </filter>
  <symbol id="${BUS_MARKER_SHADOW_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Ambient lift only, and deliberately round-ish: this layer never
         rotates, so anything shaped like the bus would disagree with the
         heading. The shaped contact shadow lives in the art symbol. -->
    <ellipse cx="31" cy="52.5" rx="16" ry="25" fill="#0b1726" opacity="0.22" filter="url(#sbt-bus-marker-shadow-blur)"/>
  </symbol>
  <symbol id="${BUS_MARKER_ART_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Top-down (roof view). The nose is at the top: heading 0 is north. -->
    <!-- Contact shadow: the silhouette itself, nudged down and blurred, so it
         turns with the vehicle the way a plan-view shadow must. -->
    <path d="M31 8.6C37.6 8.6 42.4 10 44.9 12.6 47.3 15.1 48.6 19 48.6 24.4L48.6 76.6C48.6 82.3 47.5 86.3 45.3 88.4 43.1 90.5 38.4 91.5 31 91.5 23.6 91.5 18.9 90.5 16.7 88.4 14.5 86.3 13.4 82.3 13.4 76.6L13.4 24.4C13.4 19 14.7 15.1 17.1 12.6 19.6 10 24.4 8.6 31 8.6Z" transform="translate(0 2)" fill="#0b1726" opacity="0.4" filter="url(#sbt-bus-marker-contact-blur)"/>
    <!-- Tyres and the two driver mirrors sit behind the coachwork, so only
         their outer edges break the silhouette — the plan-view tell. -->
    <rect x="9.6" y="25.8" width="6.2" height="14.2" rx="2.6" fill="#111d2b"/>
    <rect x="46.2" y="25.8" width="6.2" height="14.2" rx="2.6" fill="#111d2b"/>
    <rect x="9.6" y="62.4" width="6.2" height="15" rx="2.6" fill="#111d2b"/>
    <rect x="46.2" y="62.4" width="6.2" height="15" rx="2.6" fill="#111d2b"/>
    <rect x="7.4" y="12.6" width="7.8" height="4.4" rx="2.1" fill="#27394d"/>
    <rect x="46.8" y="12.6" width="7.8" height="4.4" rx="2.1" fill="#27394d"/>
    <!-- Coachwork. -->
    <path d="M31 8.6C37.6 8.6 42.4 10 44.9 12.6 47.3 15.1 48.6 19 48.6 24.4L48.6 76.6C48.6 82.3 47.5 86.3 45.3 88.4 43.1 90.5 38.4 91.5 31 91.5 23.6 91.5 18.9 90.5 16.7 88.4 14.5 86.3 13.4 82.3 13.4 76.6L13.4 24.4C13.4 19 14.7 15.1 17.1 12.6 19.6 10 24.4 8.6 31 8.6Z" fill="url(#sbt-bus-marker-body)" stroke="#0f2236" stroke-width="2.6" stroke-linejoin="round"/>
    <!-- Headlamps wash the nose; the tail carries the red lamps. Tiny, but at
         @2x/@3x they are the first thing that says which end is which. -->
    <path d="M18.8 11.4C22.4 10.1 39.6 10.1 43.2 11.4L41.8 14.2C37.4 13.1 24.6 13.1 20.2 14.2Z" fill="#fff6cf" opacity="0.95"/>
    <path d="M17.6 86.6C22.6 88.2 39.4 88.2 44.4 86.6L44.4 89C39.6 90.7 22.4 90.7 17.6 89Z" fill="#e23c3c"/>
    <!-- Windscreen: wide, dark, and splayed towards the cabin. -->
    <path d="M20.6 14.9C24.6 13.7 37.4 13.7 41.4 14.9L44 26.8C37.6 28.2 24.4 28.2 18 26.8Z" fill="url(#sbt-bus-marker-glass)" stroke="#12303f" stroke-width="1.3" stroke-linejoin="round"/>
    <!-- Specular sweep across the glass, so the windscreen never reads flat. -->
    <path d="M22.4 16.3C26 15.4 36 15.4 39.6 16.3" fill="none" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round" opacity="0.72"/>
    <!-- Raised roof panel: the lighter plane is what makes this read as a tall
         box seen from above instead of a flat lozenge. -->
    <path d="M18 31.4C18 30.2 19 29.4 20.4 29.4L41.6 29.4C43 29.4 44 30.2 44 31.4L44 76.4C44 77.8 43 78.6 41.6 78.6L20.4 78.6C19 78.6 18 77.8 18 76.4Z" fill="url(#sbt-bus-marker-roof)" stroke="#bb7a0d" stroke-width="1.1" stroke-linejoin="round"/>
    <!-- Roof hatches / vents. -->
    <rect x="24.8" y="35.6" width="12.4" height="9" rx="2.2" fill="#294a67" stroke="#102334" stroke-width="1.1"/>
    <rect x="26.4" y="59.2" width="9.2" height="7.4" rx="2" fill="#294a67" stroke="#102334" stroke-width="1.1"/>
    <!-- Rear window. -->
    <path d="M20.4 81.8C25 80.8 37 80.8 41.6 81.8L41.6 86.4C37 87.6 25 87.6 20.4 86.4Z" fill="#2b4c66" stroke="#12303f" stroke-width="1.2" stroke-linejoin="round"/>
  </symbol>`;

/**
 * Complete, standalone artwork. Its shadow is outside the rotating art group;
 * consumers that can layer views (web/native) keep that split at runtime.
 */
export const BUS_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}" width="${BUS_MARKER_BOX.width}" height="${BUS_MARKER_BOX.height}" aria-hidden="true" focusable="false">
  <defs>${BUS_MARKER_DEFS_SVG}</defs>
  <use href="#${BUS_MARKER_SHADOW_ID}"/>
  <g id="sbt-bus-marker-rotating-group"><use href="#${BUS_MARKER_ART_ID}"/></g>
</svg>`;

/** Standalone art-only SVG for native PNG generation; shadow stays a static native layer. */
export const BUS_MARKER_ART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}" width="${BUS_MARKER_BOX.width}" height="${BUS_MARKER_BOX.height}" aria-hidden="true">
  <defs>${BUS_MARKER_DEFS_SVG}</defs>
  <use href="#${BUS_MARKER_ART_ID}"/>
</svg>`;

export const STOP_MARKER_BOX = {
  width: 24,
  height: 32,
} as const;

/**
 * A deliberately non-vehicle stop asset: a lifted slate pin with a white ring.
 * It shares the package so map clients can converge on one stop treatment
 * without confusing it for the amber bus.
 */
export const STOP_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="${STOP_MARKER_BOX.width}" height="${STOP_MARKER_BOX.height}" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="sbt-stop-pin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#64748b"/><stop offset="1" stop-color="#334155"/>
    </linearGradient>
    <filter id="sbt-stop-lift" x="-50%" y="-35%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="1.35" flood-color="#0f172a" flood-opacity="0.32"/></filter>
  </defs>
  <path d="M12 2.5a8.5 8.5 0 0 0-8.5 8.5c0 6.4 8.5 17.5 8.5 17.5S20.5 17.4 20.5 11A8.5 8.5 0 0 0 12 2.5Z" fill="url(#sbt-stop-pin)" stroke="#fff" stroke-width="2" filter="url(#sbt-stop-lift)"/>
  <circle cx="12" cy="11" r="3.1" fill="#f8fafc"/>
</svg>`;
