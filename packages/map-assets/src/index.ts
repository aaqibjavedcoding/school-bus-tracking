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

/** Shared `<defs>` payload. This is mounted exactly once on the web map. */
export const BUS_MARKER_DEFS_SVG = `
  <linearGradient id="sbt-bus-marker-body" x1="0" y1="0" x2="0.82" y2="1">
    <stop offset="0" stop-color="#ffd56a"/>
    <stop offset="0.38" stop-color="#f7ad20"/>
    <stop offset="1" stop-color="#c96b09"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-side" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#e8890d"/>
    <stop offset="1" stop-color="#94430a"/>
  </linearGradient>
  <linearGradient id="sbt-bus-marker-glass" x1="0" y1="0" x2="0.85" y2="1">
    <stop offset="0" stop-color="#eaf8ff"/>
    <stop offset="0.45" stop-color="#77b9da"/>
    <stop offset="1" stop-color="#26506f"/>
  </linearGradient>
  <filter id="sbt-bus-marker-shadow-blur" x="-40%" y="-120%" width="180%" height="340%">
    <feGaussianBlur stdDeviation="2.2"/>
  </filter>
  <symbol id="${BUS_MARKER_SHADOW_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <ellipse cx="31" cy="84.5" rx="19" ry="4.8" fill="#0f172a" opacity="0.34" filter="url(#sbt-bus-marker-shadow-blur)"/>
    <ellipse cx="31" cy="84" rx="16" ry="3.2" fill="#0f172a" opacity="0.2"/>
  </symbol>
  <symbol id="${BUS_MARKER_ART_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Nose is at the top: heading 0 is north. The offset side is the 3/4 view. -->
    <path d="M15 32 36 15 49 24 52 67 34 88 12 77Z" fill="#172638" opacity="0.98"/>
    <!-- Dark wheel wells and chassis sit behind the amber coachwork. -->
    <path d="M12.8 48.5 18.2 45.5 19.1 63.5 13.3 66.8Z" fill="#07111e"/>
    <path d="M43.5 37.5 50.3 34.2 51.4 54.4 44.8 58Z" fill="#07111e"/>
    <path d="M13.5 70.5 20.5 67.1 21 78.8 15 81.3Z" fill="#07111e"/>
    <path d="M40.8 61.5 51.6 56.6 52 68.8 43.2 76.3Z" fill="#07111e"/>
    <ellipse cx="16.7" cy="56.4" rx="3.5" ry="5.4" fill="#334155" transform="rotate(-7 16.7 56.4)"/>
    <ellipse cx="47.6" cy="46.2" rx="3.8" ry="5.6" fill="#334155" transform="rotate(-7 47.6 46.2)"/>
    <ellipse cx="17.5" cy="74.5" rx="3.6" ry="5.2" fill="#334155" transform="rotate(-7 17.5 74.5)"/>
    <ellipse cx="46.7" cy="67" rx="3.7" ry="5.3" fill="#334155" transform="rotate(-7 46.7 67)"/>
    <path d="M15.7 30.5 35.7 15.7 47.6 24.3 47.3 67.3 32.4 82.2 15.2 74.1Z" fill="url(#sbt-bus-marker-body)" stroke="#0f172a" stroke-width="2.1" stroke-linejoin="round"/>
    <!-- The darker passenger-side face makes the coach read as a lifted 3/4 object. -->
    <path d="M39.8 20.2 47.6 24.3 47.3 67.3 32.4 82.2 32.3 36.1Z" fill="url(#sbt-bus-marker-side)" stroke="#0f172a" stroke-width="1.35" stroke-linejoin="round"/>
    <!-- Roof cap / roof line. -->
    <path d="M18.2 29.2 35.9 16.3 43.2 21.5 26.1 34.7Z" fill="#ffe49a" stroke="#71400b" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M19.6 27.6 35.8 16.1 42.4 20.8" fill="none" stroke="#fff5ca" stroke-width="1.35" stroke-linecap="round" opacity="0.94"/>
    <!-- Front windscreen: glass + white specular sweep. -->
    <path d="M26.6 28.3 35.8 21.4 40.3 24.6 31 32.1Z" fill="url(#sbt-bus-marker-glass)" stroke="#16344a" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M29.1 27.1 35.9 22.2 38 23.8" fill="none" stroke="#fff" stroke-width="1.35" stroke-linecap="round" opacity="0.82"/>
    <path d="M18.8 36.1 30.3 28.1 30.6 36.7 19.1 44.5Z" fill="url(#sbt-bus-marker-glass)" stroke="#16344a" stroke-width="1" stroke-linejoin="round"/>
    <path d="M33.2 37.2 44.1 29.3 44.2 38.1 33.4 46.2Z" fill="url(#sbt-bus-marker-glass)" stroke="#16344a" stroke-width="1" stroke-linejoin="round"/>
    <!-- Passenger windows and amber mullions. -->
    <path d="M18.9 48.4 30.8 40.1 31.1 48.7 19.2 56.8Z" fill="#315d79" stroke="#173a52" stroke-width="1"/>
    <path d="M19.3 60.7 31.2 52.6 31.6 61.3 19.6 69.3Z" fill="#315d79" stroke="#173a52" stroke-width="1"/>
    <path d="M33.6 49.1 44.3 41.1 44.4 50.1 33.8 58.1Z" fill="#315d79" stroke="#173a52" stroke-width="1"/>
    <path d="M34 62.1 44.5 54.1 44.6 63.1 34.2 71.2Z" fill="#315d79" stroke="#173a52" stroke-width="1"/>
    <!-- Bumpers, lamps and a small school-bus stripe retain legibility at 26px. -->
    <path d="M15.3 74.2 32.4 82.2 47.3 67.3 47.2 72.2 33.7 86.1 15 78.8Z" fill="#202f41" stroke="#0f172a" stroke-width="1.15" stroke-linejoin="round"/>
    <path d="M18.8 45.6 44.2 28.4" stroke="#78350f" stroke-width="1.45" opacity="0.8"/>
    <circle cx="22" cy="34.7" r="1.35" fill="#fff3a6" stroke="#7c3e08" stroke-width="0.65"/>
    <circle cx="42.4" cy="27.2" r="1.25" fill="#fff3a6" stroke="#7c3e08" stroke-width="0.65"/>
    <circle cx="20.2" cy="75.4" r="1.25" fill="#fb7185" stroke="#63142a" stroke-width="0.65"/>
    <circle cx="41.3" cy="72.5" r="1.25" fill="#fb7185" stroke="#63142a" stroke-width="0.65"/>
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
