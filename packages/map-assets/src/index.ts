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
 * The art is a clean TOP-DOWN roof view (the Uber/Ola cab-marker idiom):
 * portrait, nose up, heading 0 = north. Flat fills only — gradients turn to
 * mud at the rendered 26 × 42 dp. Everything that makes it read as "school
 * bus" at one glance is geometry, not texture:
 *
 *   1. a ~2 px white halo around the whole silhouette (contrast on any tile),
 *   2. school-bus amber body with a subtly lighter flat roof panel,
 *   3. a dark slate windshield band across the top ~20% — the heading cue,
 *   4. rows of small dark side windows down both long edges,
 *   5. two lighter roof hatches on the centre line,
 *   6. a dark rear bumper band across the bottom.
 *
 * No text (unreadable at 26 px), no wheels (invisible from above), no baked
 * shadow/halo/cone — those are separate marker layers owned by the consumers
 * (web CSS layers, native BusMarker.tsx).
 */
export const BUS_MARKER_DEFS_SVG = `
  <filter id="sbt-bus-marker-shadow-blur" x="-30%" y="-20%" width="160%" height="140%">
    <feGaussianBlur stdDeviation="2.6"/>
  </filter>
  <symbol id="${BUS_MARKER_SHADOW_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Soft under-shadow for the top-down footprint, nudged south-east. -->
    <rect x="9.5" y="10" width="43" height="88" rx="15" fill="#0f172a" opacity="0.28" filter="url(#sbt-bus-marker-shadow-blur)"/>
  </symbol>
  <symbol id="${BUS_MARKER_ART_ID}" viewBox="0 0 ${BUS_MARKER_BOX.viewBoxWidth} ${BUS_MARKER_BOX.viewBoxHeight}">
    <!-- Top-down roof view. Nose is at the top: heading 0 is north. -->
    <!-- White outline halo (~2px at render size) around the silhouette. -->
    <rect x="2.5" y="2" width="57" height="96" rx="14.5" fill="#ffffff"/>
    <!-- Flat-front rounded body: school-bus amber. -->
    <rect x="7.5" y="7" width="47" height="86" rx="10" fill="#F6B500" stroke="#D89C06" stroke-width="1.2"/>
    <!-- Subtle lighter roof panel, flat. -->
    <rect x="18" y="30" width="26" height="52" rx="5" fill="#FFC93C"/>
    <!-- Front windshield band: the heading cue, dark slate across the nose. -->
    <rect x="11.5" y="11" width="39" height="16" rx="5" fill="#16283C"/>
    <rect x="14.5" y="13.2" width="33" height="3.2" rx="1.6" fill="#3E5D80" opacity="0.6"/>
    <!-- Side window rows: four dark slate panes down each long edge. -->
    <rect x="9.5" y="31" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="9.5" y="45" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="9.5" y="59" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="9.5" y="73" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="46" y="31" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="46" y="45" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="46" y="59" width="6.5" height="10" rx="2" fill="#16283C"/>
    <rect x="46" y="73" width="6.5" height="10" rx="2" fill="#16283C"/>
    <!-- Roof hatches: two lighter amber rounded squares on the centre line. -->
    <rect x="26" y="37" width="10" height="9" rx="2.5" fill="#FFE08A" stroke="#E0A50B" stroke-width="0.9"/>
    <rect x="26" y="58" width="10" height="9" rx="2.5" fill="#FFE08A" stroke="#E0A50B" stroke-width="0.9"/>
    <!-- Rear bumper band across the tail. -->
    <rect x="12.5" y="84" width="37" height="7.5" rx="3" fill="#1D2C3E"/>
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
