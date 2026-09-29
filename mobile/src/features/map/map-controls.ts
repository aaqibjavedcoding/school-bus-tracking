/**
 * On-map control policy — **zoom buttons and the follow controls**, as pure
 * data (React-free, node-testable).
 *
 * Two field reports created this module, and both were presentation problems
 * rather than camera-policy problems, so nothing here touches
 * `follow-camera.ts`'s reducer: it decides *what the camera does*, this decides
 * *what the driver is offered*.
 *
 * ### 1. Zoom buttons, because pinching while driving is not a thing
 *
 * The embedded driver map is a 240–260 dp card inside a scrolling screen. Even
 * with gesture ownership fixed (the map keeps the touches that start on it),
 * a two-finger pinch is a two-hand gesture, and a driver has at most one hand
 * and half a second. Every driver-facing map ships +/− buttons for that
 * reason, and a button press is also the only zoom that can be made *not* to
 * knock the camera out of follow mode: it is a programmatic camera move, so
 * MapLibre reports no `userInteraction`, and the controller suppresses its own
 * zoom-delta fallback for the move it just made
 * (`follow-camera-controller.ts` → `zoomBy`).
 *
 * The step and the bounds live here rather than in the component so the
 * "already fully zoomed in" state is decided once and is testable: a button
 * that still looks tappable at the maximum zoom is exactly the kind of silent
 * no-op the follow control was reported for (P1-6).
 *
 * ### 2. One primary control: "Follow bus"
 *
 * The old block was three states across two buttons — a primary that *toggled
 * follow off* while following, plus a separate "Follow bus" chip that only
 * appeared while following-and-exploring. A driver who had panned the map and
 * wanted the bus back could tap the big button and get… follow switched off.
 *
 * The rule now:
 *
 * - **primary** is always "Follow bus": re-centre on the marker **and**
 *   re-enable following. It is never a toggle, so its tap can never mean the
 *   opposite of its label.
 * - **secondary** is the explicit, visually distinct follow switch. While
 *   following it reads "Follow: on" and turning it off is a deliberate,
 *   separate act; with follow off it shows "Follow: off" as a disabled state
 *   pill, because the way back on is the primary next to it.
 * - **no fix** (the field state — "No fix from this device yet"): there is no
 *   marker to centre on, so `recenter()` would be a silent no-op
 *   (`follow-camera-controller.ts` returns early when `rendered` is `null`).
 *   The primary is therefore disabled and *says why* — "Waiting for GPS fix" —
 *   instead of looking tappable and doing nothing.
 */

// ── Zoom ───────────────────────────────────────────────────────────────────

/**
 * One button press, in zoom levels.
 *
 * A whole level doubles/halves the scale, which is what a pinch does in one
 * comfortable gesture and what every other driver map's buttons do. Half steps
 * feel broken (nothing appears to happen); two levels overshoot past the
 * street names the driver is looking for.
 */
export const MAP_ZOOM_STEP = 1;

/**
 * Button bounds. Not a `minZoom`/`maxZoom` clamp on the map — a pinch may
 * still go anywhere the engine allows; these only bound what the *buttons*
 * will ask for, so a driver cannot button-press their way to the whole globe
 * (z3 already shows a subcontinent) or past the deepest tiles OpenFreeMap
 * serves (z19). `fit-camera.ts` floors automatic framing at z13 for a related
 * reason: the zooms where a street map draws no names are useless here.
 */
export const MAP_ZOOM_MIN = 3;
export const MAP_ZOOM_MAX = 19;

export type ZoomDirection = 'in' | 'out';

/** Clamps a zoom level into the buttons' range. */
export function clampMapZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MAP_ZOOM_MIN;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, zoom));
}

/**
 * Where one button press should take the camera, or `null` when the press
 * would change nothing (already at the bound, or no zoom is known yet).
 *
 * Returning `null` rather than the current zoom is deliberate: the caller must
 * not issue a camera command that moves nothing — a no-op `zoomTo` still
 * produces a region report, and a region report while following is noise the
 * camera has to reason about.
 */
export function zoomStepTarget(
  currentZoom: number | null,
  direction: ZoomDirection,
  step: number = MAP_ZOOM_STEP,
): number | null {
  if (currentZoom === null || !Number.isFinite(currentZoom)) return null;
  const raw = direction === 'in' ? currentZoom + step : currentZoom - step;
  const target = clampMapZoom(raw);
  // Sub-0.01 differences are below what a user can see and below the region
  // report's own rounding, so they count as "already there".
  if (Math.abs(target - clampMapZoom(currentZoom)) < 0.01) return null;
  return target;
}

export interface ZoomLimits {
  canZoomIn: boolean;
  canZoomOut: boolean;
}

/**
 * Whether each button can still do something. Before the first region report
 * the zoom is unknown, and the buttons stay enabled: the first press then
 * resolves against the engine's real zoom rather than greying out a control
 * the driver can see is applicable.
 */
export function zoomLimits(currentZoom: number | null): ZoomLimits {
  if (currentZoom === null || !Number.isFinite(currentZoom)) {
    return { canZoomIn: true, canZoomOut: true };
  }
  return {
    canZoomIn: zoomStepTarget(currentZoom, 'in') !== null,
    canZoomOut: zoomStepTarget(currentZoom, 'out') !== null,
  };
}

// ── Follow controls ────────────────────────────────────────────────────────

export interface DriverFollowControlsInput {
  /** A position exists to centre on (`localFix !== null`). */
  hasFix: boolean;
  /** The screen's follow switch (the frame gate in `DriverTripMap`). */
  followEnabled: boolean;
  /** The camera controller's mode: the user's gesture owns the camera. */
  exploring: boolean;
}

export interface DriverFollowPrimary {
  /** "Follow bus", or the reason it cannot be used. */
  labelKey: 'map.followBus' | 'map.followWaitingFix';
  /** No marker to centre on → the tap would be a silent no-op. */
  disabled: boolean;
  /** Following and not exploring: the camera is already on the bus. */
  active: boolean;
}

export interface DriverFollowSecondary {
  /** Hidden while there is no fix: nothing to follow, nothing to pause. */
  visible: boolean;
  /** The switch's own state, never the action — the primary is the action. */
  labelKey: 'map.followOn' | 'map.followOff';
  /** The off state is shown, not tappable: the primary turns follow back on. */
  disabled: boolean;
}

export interface DriverFollowControlsView {
  primary: DriverFollowPrimary;
  secondary: DriverFollowSecondary;
  /**
   * The screen-reader live line. Four states, four sentences — the follow mode
   * is otherwise invisible to a non-sighted driver.
   */
  stateKey:
    | 'map.followingA11y'
    | 'map.exploringA11y'
    | 'map.followOffA11y'
    | 'map.noFixA11y';
  /** True while the controls are disabled for want of a position. */
  waitingForFix: boolean;
}

/**
 * The whole control block, as data.
 *
 * Note what is *not* here: nothing decides whether to move the camera. The
 * primary always means "recenter + follow" and the controller's `recenter`
 * event is idempotent, so pressing it while already following is a legitimate
 * no-op-with-feedback (the camera re-centres on a bus that may have drifted
 * under the minimum-shift threshold).
 */
export function driverFollowControls(
  input: DriverFollowControlsInput,
): DriverFollowControlsView {
  const { hasFix, followEnabled, exploring } = input;

  if (!hasFix) {
    return {
      primary: { labelKey: 'map.followWaitingFix', disabled: true, active: false },
      secondary: { visible: false, labelKey: 'map.followOff', disabled: true },
      stateKey: 'map.noFixA11y',
      waitingForFix: true,
    };
  }

  const following = followEnabled && !exploring;
  return {
    primary: { labelKey: 'map.followBus', disabled: false, active: following },
    secondary: {
      visible: true,
      labelKey: followEnabled ? 'map.followOn' : 'map.followOff',
      disabled: !followEnabled,
    },
    stateKey: !followEnabled
      ? 'map.followOffA11y'
      : exploring
        ? 'map.exploringA11y'
        : 'map.followingA11y',
    waitingForFix: false,
  };
}
