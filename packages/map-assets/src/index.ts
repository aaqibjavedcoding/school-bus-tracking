export * from './map-camera';

/**
 * Shared map artwork.
 *
 * There is intentionally one school-bus drawing in this workspace. Web keeps
 * its symbols in a document-level SVG `<defs>` and every marker references it
 * with `<use>`. The drawing is a TOP-DOWN (roof view) school bus whose nose
 * points up, so rotating it by the heading reads like a navigation app; the native build script rasterises the same source into the
 * small density-specific PNGs Metro bundles. Neither consumer redraws a bus.
 */

/**
 * The visible marker footprint is intentionally unchanged from the legacy
 * sprite; only the artwork inside it became a top-down vehicle. The
 * coordinate is the exact centre of this rectangle at every heading; `rotationBox` is the surrounding square that prevents diagonal
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

/** Shared `<defs>` payload. This is mounted exactly once on the web map. */
export const BUS_MARKER_DEFS_SVG = `
  <linearGradient id="sbt-bus-marker-body" x1="0" y1="0" x2="1" y2="0.15">
    <stop offset="0" stop-color="#c96b09"/>
    <stop offset="0.18" stop-color="#f7ad20"/>
    <stop offset="0.5" stop-color="#ffd56a"/>
    <stop offset="0.82" stop-color="#f7ad20"/>
    <stop offset="1" stop-color="#b85f07"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-roof" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffc247"/>
    <stop offset="0.45" stop-color="#ffe9a8"/>
    <stop offset="1" stop-color="#f0a21a"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-glass" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#eaf8ff"/>
    <stop offset="0.42" stop-color="#77b9da"/>
    <stop offset="1" stop-color="#1d4761"/>
  </linearGradient>
  <filter id="sbt-bus-marker-shadow-blur" x="-45%" y="-25%" width="190%" height="150%">
    <feGaussianBlur stdDeviation="2.6"/>
  </filter>
  <symbol id="${BUS_MARKER_SHADOW_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Top-down view: the vehicle casts its shadow straight under itself, so
         the blob is concentric with the coach instead of sitting below it. -->
    <rect x="11" y="11" width="40" height="80" rx="15" fill="#0f172a" opacity="0.34" filter="url(#sbt-bus-marker-shadow-blur)"/>
  </symbol>
  <symbol id="${BUS_MARKER_ART_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- TOP-DOWN (roof view) school bus. The nose points up: heading 0 is
         north, and the whole symbol is rotated about its exact centre
         (31, 50), which is also the GPS coordinate. Nothing here is drawn in
         perspective, so the silhouette stays a readable vehicle at 26x42 dp
         and at every heading. -->
    <!-- Wheels first: dark rounded stubs peeking out from under the body. -->
    <g fill="#0b1220">
      <rect x="6.4" y="26" width="7.2" height="15" rx="3.2"/>
      <rect x="48.4" y="26" width="7.2" height="15" rx="3.2"/>
      <rect x="6.4" y="62" width="7.2" height="15" rx="3.2"/>
      <rect x="48.4" y="62" width="7.2" height="15" rx="3.2"/>
    </g>
    <!-- Wing mirrors: the small ears that read "front" even at 26 dp. -->
    <g fill="#1f2937">
      <rect x="5.6" y="19.5" width="6.4" height="4.2" rx="2.1"/>
      <rect x="50" y="19.5" width="6.4" height="4.2" rx="2.1"/>
    </g>
    <!-- Coachwork: one rounded body, rounder at the nose than at the tail. -->
    <path d="M31 7.5c-7.1 0-11.8 2.6-13.4 6.1-1.2 2.7-1.7 7-1.7 12.6v48c0 7.8 0.5 12.8 1.8 15.2 1.6 3 5.9 4.1 13.3 4.1s11.7-1.1 13.3-4.1c1.3-2.4 1.8-7.4 1.8-15.2v-48c0-5.6-0.5-9.9-1.7-12.6C42.8 10.1 38.1 7.5 31 7.5Z"
      fill="url(#sbt-bus-marker-body)" stroke="#12202f" stroke-width="2.4" stroke-linejoin="round"/>
    <!-- Roof cap / roof line: the lit panel down the middle of the roof. -->
    <path d="M31 12.6c-5.3 0-8.8 1.9-10 4.5-0.9 2-1.3 5.2-1.3 9.3v47.4c0 5.8 0.4 9.5 1.3 11.3 1.2 2.2 4.4 3 10 3s8.8-0.8 10-3c0.9-1.8 1.3-5.5 1.3-11.3V26.4c0-4.1-0.4-7.3-1.3-9.3-1.2-2.6-4.7-4.5-10-4.5Z"
      fill="url(#sbt-bus-marker-roof)" opacity="0.95"/>
    <!-- Front windscreen: glass plus a white specular sweep across it. -->
    <path d="M20.6 20.3c1.6-4 5.3-6 10.4-6s8.8 2 10.4 6l-1.1 5.4c-2.9-1.9-6-2.8-9.3-2.8s-6.4 0.9-9.3 2.8Z"
      fill="url(#sbt-bus-marker-glass)" stroke="#16344a" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M23.6 19.4c1.8-1.8 4.3-2.7 7.4-2.7" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>
    <!-- Side glazing: the passenger windows, read as two dark rails. -->
    <g fill="#2c5774" stroke="#16344a" stroke-width="0.9">
      <rect x="17.5" y="32" width="4.6" height="12" rx="1.6"/>
      <rect x="17.5" y="46.5" width="4.6" height="12" rx="1.6"/>
      <rect x="17.5" y="61" width="4.6" height="12" rx="1.6"/>
      <rect x="39.9" y="32" width="4.6" height="12" rx="1.6"/>
      <rect x="39.9" y="46.5" width="4.6" height="12" rx="1.6"/>
      <rect x="39.9" y="61" width="4.6" height="12" rx="1.6"/>
    </g>
    <!-- Roof hatch and the two black roof ribs of a school coach. -->
    <rect x="26.6" y="40" width="8.8" height="9" rx="2" fill="#f8fafc" stroke="#9a6a12" stroke-width="1"/>
    <path d="M25 56.5h12M25 64h12" stroke="#8a4d0a" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>
    <!-- Rear window band, so the tail is never mistaken for the nose. -->
    <path d="M22.2 79.5h17.6v5.2c-2.6 1-5.6 1.5-8.8 1.5s-6.2-0.5-8.8-1.5Z" fill="#2c5774" stroke="#16344a" stroke-width="1.1" stroke-linejoin="round"/>
    <!-- Lamps: warm pair at the nose, red pair at the tail. -->
    <circle cx="22.4" cy="12.6" r="1.9" fill="#fff3a6" stroke="#7c3e08" stroke-width="0.8"/>
    <circle cx="39.6" cy="12.6" r="1.9" fill="#fff3a6" stroke="#7c3e08" stroke-width="0.8"/>
    <circle cx="23" cy="88.2" r="1.8" fill="#fb7185" stroke="#63142a" stroke-width="0.8"/>
    <circle cx="39" cy="88.2" r="1.8" fill="#fb7185" stroke="#63142a" stroke-width="0.8"/>
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
