import { t } from '../../lib/i18n.ts';
import {
  ACCURACY_APPROXIMATE_METERS,
  ACCURACY_CIRCLE_MAX_METERS,
} from '../map/tracking-presentation.ts';
import {
  LOCAL_FIX_FRESH_WINDOW_MS,
  type CrewTrackingStatus,
  type TrackingConnectionState,
} from './tracking-status.ts';

/**
 * What the **Driver Trip map** may say about the position it draws.
 *
 * ### The source is explicit: this device's own GPS
 *
 * The marker on the driver's map is drawn from
 * `useCrewLocationSharing().stats.lastFix` — the newest coordinate *this phone
 * produced*. That is a deliberate choice between two data sources, and the
 * distinction is the whole point of this module:
 *
 * | source                                  | what it proves                                | why not the marker                                            |
 * | --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
 * | **local device fix** (chosen)            | this phone has a position                     | *is* the marker: the driver's question is "where am I on my run", and their own GPS is the newest, most accurate answer available on the device — and it keeps working with no network |
 * | server-acknowledged position             | the school has a position                     | at least one throttled round trip behind the device (~2.5–4 s), and the lifecycle does not retain the acknowledged coordinates at all. Driving the driver's screen from it would show them where the server *thinks* they are |
 *
 * Neither is allowed to stand for the other. The local fix is **not** proof of
 * delivery, so nothing here may claim the school can see it; the server
 * acknowledgement is **not** the latest local fix, so it is never drawn as the
 * marker. Delivery is reported by `tracking-status.ts` and nothing else — this
 * module copies `schoolSeesLive` from the crew status rather than deriving it,
 * so there is one authority and the map cannot invent a second opinion.
 *
 * ### Crew semantics, not observer semantics
 *
 * The freshness gates here are the **crew** ones: "does this device have a fix"
 * (`LOCAL_FIX_FRESH_WINDOW_MS`) and "has the server acknowledged anything"
 * (`SERVER_ACK_LIVE_WINDOW_MS`, surfaced as `schoolSeesLive`). The observer
 * windows in `map/tracking-presentation.ts` describe *how old a position
 * delivered to someone else's screen is* — the same durations today, a
 * different question, and not this screen's to answer.
 *
 * The one thing borrowed from the observer module is the **accuracy** rule
 * (≥50 m is "approximate", above 500 m it is stated in words instead of drawn):
 * that is a drawing decision, identical for every map in the app, and
 * duplicating the numbers would let the two maps disagree about what "roughly
 * here" looks like.
 */

/** Where a drawn position stands, from the device's point of view. */
export type DriverPositionState =
  /** No fix has ever come from this device. */
  | 'no-fix'
  /** A fix inside the local-freshness window, while sharing is running. */
  | 'live'
  /** A fix exists but is either old, or no longer being produced. */
  | 'last-known';

/**
 * How current the drawn position is. Always shown, so the driver can always see
 * whether their own GPS is alive — including in the degraded cases, where the
 * old single-line panel said "not delivered" and stopped saying how old the
 * position was, which is the moment that number matters most.
 *
 * `gps.lastUpdate` is reused from the crew dictionary on purpose: the strip two
 * cards up already says "Updated {time}" for the same fact, and two spellings of
 * one number on one screen is how a driver learns to distrust both.
 */
export type DriverMapPositionKey = 'gps.lastUpdate' | 'gps.noFix';

/**
 * Whether the school can see the drawn position. `null` when it can, and when
 * there is no position to have an opinion about: the GPS strip above states
 * delivery in the authority's own words, and this module exists so the map never
 * invents a second opinion.
 */
export type DriverMapDeliveryKey =
  | 'driverMap.note.schoolStale'
  | 'driverMap.note.notDelivered'
  | 'driverMap.note.offline'
  | 'driverMap.note.notSharing';

export interface DriverMapPresentationInput {
  /** The crew status verdict — the delivery authority, copied not recomputed. */
  status: CrewTrackingStatus;
  /**
   * Age of the newest fix **this device** produced, from
   * `CrewTrackingStatusResult.localFixAgeMs` (device clock).
   */
  localFixAgeMs: number | null;
  /** Device-reported accuracy radius in metres. */
  accuracyMeters: number | null;
  /** Crew socket state, for telling "offline" from "not delivered". */
  connection: TrackingConnectionState;
  /** Injectable window, so a spec can move the boundary without waiting. */
  localFreshWindowMs?: number;
}

export interface DriverMapPresentation {
  state: DriverPositionState;
  /**
   * True only while the device's own stream is current **and** tracking is
   * running. A marker that keeps gliding after the fixes stopped is the lie
   * this exists to prevent — the same rule the observer map applies, with the
   * crew's definition of "current".
   */
  animate: boolean;
  /** True when the copy must not imply a precise road position. */
  approximate: boolean;
  /** Radius to draw as an uncertainty circle, or `null` to draw none. */
  accuracyCircleMeters: number | null;
  /**
   * The marker's data source. Constant by construction, and named in the type
   * so a future caller cannot quietly point it at the server's copy.
   */
  source: 'device';
  /**
   * **Copied from the crew status, never derived here.** True only on a server
   * acknowledgement inside the live window; this is the only flag in the
   * product that may be worded as "the school can see the bus".
   */
  schoolSeesLive: boolean;
  /** How current the drawn position is. Always shown. */
  positionKey: DriverMapPositionKey;
  /** Whether the school can see it, or `null` when there is nothing to add. */
  deliveryKey: DriverMapDeliveryKey | null;
}

/** Statuses in which no fix is being produced, whatever the device last saw. */
const NOT_SHARING: ReadonlySet<CrewTrackingStatus> = new Set<CrewTrackingStatus>([
  'stopped',
  'services-off',
  'permission-blocked',
  'revoked',
]);

/** Statuses in which the delivery path itself is down. */
const LINK_DOWN: ReadonlySet<CrewTrackingStatus> = new Set<CrewTrackingStatus>([
  'connecting',
  'reconnecting',
]);

export function deriveDriverMapPresentation(
  input: DriverMapPresentationInput,
): DriverMapPresentation {
  const localFreshWindowMs = input.localFreshWindowMs ?? LOCAL_FIX_FRESH_WINDOW_MS;
  const age = input.localFixAgeMs;
  const hasFix = age !== null && Number.isFinite(age);
  const fresh = hasFix && age <= localFreshWindowMs;
  const sharingRunning = !NOT_SHARING.has(input.status);

  const accuracy =
    typeof input.accuracyMeters === 'number' &&
    Number.isFinite(input.accuracyMeters) &&
    input.accuracyMeters >= 0
      ? input.accuracyMeters
      : null;

  const state: DriverPositionState = !hasFix
    ? 'no-fix'
    : fresh && sharingRunning
      ? 'live'
      : 'last-known';
  const schoolSeesLive = input.status === 'live';

  // Line one always answers "how current is what you are looking at".
  const positionKey: DriverMapPositionKey = hasFix ? 'gps.lastUpdate' : 'gps.noFix';

  // Line two only exists to correct a possible misreading of a *drawn*
  // position: it is absent when the school can see one, and absent when there is
  // nothing drawn to misread. It never answers "is my GPS working".
  let deliveryKey: DriverMapDeliveryKey | null = null;
  if (!sharingRunning) {
    // A frozen marker must say why it is frozen.
    deliveryKey = 'driverMap.note.notSharing';
  } else if (!hasFix || schoolSeesLive) {
    deliveryKey = null;
  } else if (LINK_DOWN.has(input.status) || input.connection !== 'connected') {
    // The phone may have GPS; the school has no path to it right now.
    deliveryKey = 'driverMap.note.offline';
  } else if (input.status === 'stale') {
    // The school is not blind — it has a position, just an older one than the
    // driver does. "Not delivered yet" would be a false claim about a
    // two-minute-old acknowledgement, and this module exists to not make it.
    deliveryKey = 'driverMap.note.schoolStale';
  } else {
    deliveryKey = 'driverMap.note.notDelivered';
  }

  return {
    state,
    animate: state === 'live',
    approximate: accuracy !== null && accuracy > ACCURACY_APPROXIMATE_METERS,
    accuracyCircleMeters:
      accuracy !== null &&
      accuracy > ACCURACY_APPROXIMATE_METERS &&
      accuracy <= ACCURACY_CIRCLE_MAX_METERS
        ? accuracy
        : null,
    source: 'device',
    schoolSeesLive,
    positionKey,
    deliveryKey,
  };
}

/**
 * Resolves both panel lines to text, through the real dictionaries.
 *
 * A `switch` over single keys rather than `t(someUnion)`: `t()` is typed on one
 * key at a time, and a union would erase the placeholder check that makes a
 * missing `{time}` a compile error. `time` is the caller's formatted age of the
 * device's newest fix (it may be `''` when there is no fix at all); `delivery`
 * is `null` when there is nothing honest to add.
 */
export function driverMapCopy(
  presentation: Pick<DriverMapPresentation, 'positionKey' | 'deliveryKey'>,
  time: string,
): { position: string; delivery: string | null } {
  const position =
    presentation.positionKey === 'gps.lastUpdate' ? t('gps.lastUpdate', { time }) : t('gps.noFix');

  let delivery: string | null = null;
  switch (presentation.deliveryKey) {
    case 'driverMap.note.schoolStale':
      delivery = t('driverMap.note.schoolStale');
      break;
    case 'driverMap.note.notDelivered':
      delivery = t('driverMap.note.notDelivered');
      break;
    case 'driverMap.note.offline':
      delivery = t('driverMap.note.offline');
      break;
    case 'driverMap.note.notSharing':
      delivery = t('driverMap.note.notSharing');
      break;
    case null:
      break;
  }

  return { position, delivery };
}

// ── Stop markers ───────────────────────────────────────────────────────────

/**
 * Which pin a stop gets on the Driver Trip map.
 *
 * `plain` is the small slate dot every stop has always been; `next` is the
 * one big amber pin with the NEXT badge. The next-stop id is an **input** —
 * the screen passes `deriveTripProgressForTrip(...).nextStop?.id` down — so
 * the map can never develop a second opinion about which stop is next: the
 * marker, the navigation card, the kids card and the voice all read the one
 * derivation (T1). A stop id that is `null` or unknown draws `plain` pins
 * everywhere, never a guessed highlight.
 */
export type DriverStopMarkerKind = 'plain' | 'next';

export function driverStopMarkerKind(
  stopId: string,
  nextStopId: string | null | undefined,
): DriverStopMarkerKind {
  return nextStopId != null && stopId === nextStopId ? 'next' : 'plain';
}
