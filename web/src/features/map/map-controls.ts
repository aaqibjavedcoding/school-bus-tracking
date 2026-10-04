/**
 * Google-style map chrome (web, Session 6 step 4).
 *
 * Three additions, all client-side, all free:
 *
 * 1. **Compass** — visible ONLY while the map is rotated; tapping it resets
 *    the bearing. MapLibre's built-in navigation compass is always-on and
 *    cannot express "appears only when rotated", so `MapViewInner` disables
 *    it (`showCompass: false`) and mounts the small control built below.
 *    It re-uses the engine's own `easeTo` — it is not a camera system.
 * 2. **Scale bar** — the engine's `ScaleControl`; it has no policy of its
 *    own, so there is nothing here to pin.
 * 3. **Recentre** — the Google-style target button. It hands every tap to
 *    the EXISTING follow-camera behaviour (`dispatch({type:'recenter'})`,
 *    the same path the Follow bus button takes); its only decision of its
 *    own is *when it should exist*, which is pinned below.
 *
 * Visibility/rotation/duration rules are pure and live here rather than in
 * the component, so they are spec'd under `node --test` without a DOM or a
 * GL context. Only `createCompassControl` touches the DOM, and only in the
 * browser (it is imported by the map component, never executed by a spec).
 */

// --- pure decisions --------------------------------------------------------

/**
 * Bearing window (degrees) treated as "still north-up": below it the compass
 * hides. Sub-degree wobble from fit/ease settling must not flash the button.
 */
export const COMPASS_HIDDEN_BEARING_EPSILON_DEG = 0.5;

export const COMPASS_RESET_NORTH_DURATION_MS = 220;

/**
 * Into `(-180, 180]`: 270° ≡ −90°, 720° ≡ 0°, and a non-finite reading is
 * treated as north (a compass that cannot know the bearing shows nothing,
 * not a wild arrow).
 */
export function normalizeBearingDeg(bearingDeg: number): number {
  if (!Number.isFinite(bearingDeg)) return 0;
  let deg = bearingDeg % 360;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  return deg;
}

/** The compass exists only to undo rotation; a north-up map hides it. */
export function shouldShowCompass(bearingDeg: number): boolean {
  return Math.abs(normalizeBearingDeg(bearingDeg)) > COMPASS_HIDDEN_BEARING_EPSILON_DEG;
}

/** The needle always points north, so it counter-rotates the camera bearing. */
export function compassNeedleRotationDeg(bearingDeg: number): number {
  // `|| 0`: north-up counter-rotates to -0, which is not `Object.is`-equal to
  // 0 and renders as "-0deg" — collapse it.
  return -normalizeBearingDeg(bearingDeg) || 0;
}

/** Resetting north animates — unless the user asked the OS for less motion. */
export function resetNorthDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : COMPASS_RESET_NORTH_DURATION_MS;
}

/**
 * The recentre control exists only while there is something to recentre
 * FROM: the user took the camera (the follow-camera's `exploring` mode).
 * While the camera already follows the bus it would be a no-op button.
 */
export function shouldShowRecentreControl(followMode: string): boolean {
  return followMode === 'exploring';
}

// --- the compass control (browser only) ------------------------------------

/** The slice of the MapLibre map the compass needs (also the spec seam). */
export interface CompassControlMapLike {
  getBearing(): number;
  easeTo(options: { bearing: number; duration: number }): unknown;
  on(type: string, listener: () => void): unknown;
  off(type: string, listener: () => void): unknown;
}

/** Structurally MapLibre's `IControl` (kept structural so tests need no engine). */
export interface CompassControlLike {
  onAdd(map: CompassControlMapLike): HTMLElement;
  onRemove(map: CompassControlMapLike): void;
}

const COMPASS_HIDDEN_CLASS = 'is-hidden';

/**
 * A 38 px round button carrying a two-half needle (amber north, slate
 * south). MapLibre drives: `rotate` events update needle angle + hidden
 * class imperatively — no React state, so a rotation gesture costs zero
 * re-renders. A tap resets the bearing with the engine's own `easeTo`,
 * instant under the reduced-motion preference.
 */
export function createCompassControl(options: {
  reducedMotion: () => boolean;
}): CompassControlLike {
  let map: CompassControlMapLike | null = null;
  let container: HTMLDivElement | null = null;
  let needle: HTMLSpanElement | null = null;

  const update = () => {
    if (!map || !container || !needle) return;
    const bearing = map.getBearing();
    container.classList.toggle(COMPASS_HIDDEN_CLASS, !shouldShowCompass(bearing));
    needle.style.transform = `rotate(${compassNeedleRotationDeg(bearing)}deg)`;
  };

  return {
    onAdd(nextMap: CompassControlMapLike): HTMLElement {
      map = nextMap;
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group sbt-compass-control';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sbt-compass-button';
      button.setAttribute('aria-label', 'Reset bearing to north');
      button.title = 'Reset north';
      button.addEventListener('click', () => {
        map?.easeTo({ bearing: 0, duration: resetNorthDurationMs(options.reducedMotion()) });
      });

      needle = document.createElement('span');
      needle.className = 'sbt-compass-needle';
      needle.setAttribute('aria-hidden', 'true');

      button.append(needle);
      container.append(button);
      nextMap.on('rotate', update);
      update();
      return container;
    },
    onRemove(): void {
      map?.off('rotate', update);
      container?.remove();
      map = null;
      container = null;
      needle = null;
    },
  };
}
