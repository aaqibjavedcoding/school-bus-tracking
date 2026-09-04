import { BadRequestException, Logger, NotFoundException } from '../../framework';
import { Op, type WhereOptions } from 'sequelize';
import {
  LIVE_TRACKING_EVENTS,
  LiveTrackingEvent,
  RouteAssignmentRole,
  TripStatus,
  UserRole,
  liveTrackingRoomName,
  type TripLocationHistoryQuery,
  type TripLocationHistoryResponse,
  type TripLocationLatestResponse,
  type TripLocationResponse,
  type TripLocationUpdateAck,
  type TripLocationUpdateEvent,
  type TripTrackingStartedEvent,
  type TripTrackingStoppedEvent,
} from '@school-bus-tracking/shared-types';
import {
  getTripTrackingState,
  isTripTrackingActive,
  tripLocationHistoryQuerySchema,
  tripLocationUpdateSchema,
} from '@school-bus-tracking/validation';
import {
  RouteAssignment,
  Stop,
  Student,
  StudentGuardian,
  Trip,
  TripLocation,
} from '../../database/models';
import type { TenantRequestUser as RequestUser } from '../../common/guards';
import { StopArrivalsService } from '../eta/stop-arrivals.service';
import {
  DEFAULT_HISTORY_LIMIT,
  LIVE_TRACKING_ASSIGNMENTS_REPOSITORY,
  LIVE_TRACKING_CONFIG,
  LIVE_TRACKING_GUARDIANS_REPOSITORY,
  LIVE_TRACKING_NO_LOCATION_MESSAGE,
  LIVE_TRACKING_REPOSITORY,
  LIVE_TRACKING_STOPS_REPOSITORY,
  LIVE_TRACKING_STUDENTS_REPOSITORY,
  LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE,
  LIVE_TRACKING_TRIPS_REPOSITORY,
} from './live-tracking.constants';

/** Environment-backed tuning of the tracking pipeline (see `config/`). */
export interface LiveTrackingConfig {
  /** Minimum gap between accepted fixes of one crew device (ms). */
  gpsMinIntervalMs: number;
  /** How far a device clock may run ahead of the server (ms). */
  maxFutureSkewMs: number;
  /** How far a device clock may lag behind the server (ms). */
  maxPastSkewMs: number;
}

/** Room-scoped broadcast sink attached by the gateway once the socket server is up. */
export type LiveTrackingBroadcaster = (
  room: string,
  event: LiveTrackingEvent,
  payload: unknown,
) => void;

/** The current latest fix of a trip, used for the out-of-order comparison. */
interface LatestFix {
  recordedAt: number;
  receivedAt: number;
  id: string;
}

/** One entry of the per (trip, crew user) throttle map. */
interface ThrottleEntry {
  lastAcceptedAt: number;
  socketId: string;
}

/** Server-side decision for a join request of the tracking namespace. */
export type TripObservationAuthorization =
  { ok: true; trip: Trip } | { ok: false; reason: 'trip_not_found' | 'unauthorized' };

/** Result of one `trip:location:update` handling. */
export interface RecordLocationResult {
  ack: TripLocationUpdateAck;
  /** Present when the fix replaced the latest and was broadcast to the room. */
  broadcast?: { event: LiveTrackingEvent; payload: TripLocationUpdateEvent };
}

/** Result of one trip lifecycle notification. */
export interface TripTrackingTransitionResult {
  event: LiveTrackingEvent | null;
  payload: TripTrackingStartedEvent | TripTrackingStoppedEvent | null;
}

/**
 * Tenant-safe live GPS tracking for active trips.
 *
 * Every write path runs the same pipeline:
 *
 * 1. **Authenticate** — the caller is the verified JWT subject (the gateway
 *    verified the token with the shared JWT configuration before the handler
 *    ever ran);
 * 2. **Authorize** — the trip is resolved by `(id, school_id)` where
 *    `school_id` comes from the JWT, then the caller must be the trip's
 *    school admin, its rostered driver/conductor (dispatch snapshot or an
 *    active roster row effective on the trip date — the same rule trip
 *    attendance applies) or, for reads only, the parent of a student whose
 *    home stop sits on the trip's route;
 * 3. **Validate** — the payload is checked with the strict Zod schemas from
 *    `@school-bus-tracking/validation`; a `school_id`, a crew id or a server
 *    timestamp smuggled into the payload is rejected, not stripped;
 * 4. **Bound** — device clocks are allowed a configurable skew window, and
 *    fixes are throttled per trip and crew device;
 * 5. **Persist & broadcast** — the row is written with the server receipt
 *    time and, only when it is the newest fix, re-broadcast to the trip's
 *    Socket.IO room (room membership is itself authorization-gated).
 *
 * Cross-tenant, cross-trip and unauthorized access all collapse into the
 * same generic responses/acks as a non-existent trip, so probing can never
 * confirm that a resource exists.
 */
export class LiveTrackingService {
  constructor(
    private readonly locations: typeof TripLocation,
    private readonly trips: typeof Trip,
    private readonly assignments: typeof RouteAssignment,
    private readonly students: typeof Student,
    private readonly stops: typeof Stop,
    private readonly guardians: typeof StudentGuardian,
    private readonly config: LiveTrackingConfig,
    // Task 22: geofence arrival evaluation after every accepted latest fix.
    private readonly arrivals: StopArrivalsService,
  ) {}
  private readonly logger = new Logger(LiveTrackingService.name);

  /** Room-scoped broadcaster attached by the gateway; `undefined` in unit tests. */
  private broadcaster: LiveTrackingBroadcaster | undefined;

  /** In-memory latest fix per trip (cold cache is filled from the database). */
  private readonly latestCache = new Map<string, LatestFix>();

  /** Last accepted fix per `${tripId}:${userId}`, for throttling. */
  private readonly throttles = new Map<string, ThrottleEntry>();

  /** Last observed tracking state per trip, for lifecycle edge detection. */
  private readonly trackingStates = new Map<string, string>();

  /** Attach (or replace) the room broadcaster; the gateway does this once. */
  attachBroadcaster(broadcaster: LiveTrackingBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /** Drop the broadcaster (used in tests); emits become no-ops. */
  detachBroadcaster(): void {
    this.broadcaster = undefined;
  }

  // ---------------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------------

  /**
   * Decides whether the caller may *observe* a trip (join its room, read its
   * locations): same tenant, plus one of the observer rules. The two denial
   * reasons are deliberately indistinguishable from the outside.
   */
  async authorizeObservation(
    user: RequestUser,
    tripId: string,
  ): Promise<TripObservationAuthorization> {
    const trip = await this.trips.findOne({
      where: { id: tripId, school_id: user.school_id },
    });
    if (!trip) {
      return { ok: false, reason: 'trip_not_found' };
    }

    if (user.role === UserRole.SCHOOL_ADMIN) {
      return { ok: true, trip };
    }

    if (user.role === UserRole.DRIVER || user.role === UserRole.CONDUCTOR) {
      return (await this.isCrewOfTrip(user, trip))
        ? { ok: true, trip }
        : { ok: false, reason: 'unauthorized' };
    }

    if (user.role === UserRole.PARENT) {
      return (await this.hasLinkedChildOnTrip(user, trip))
        ? { ok: true, trip }
        : { ok: false, reason: 'unauthorized' };
    }

    // `SUPER_ADMIN` (and anything unrecognized) is platform-level and has no
    // tenant observation rights here.
    return { ok: false, reason: 'unauthorized' };
  }

  /**
   * True when the user is the trip's crew: the trip's own dispatch snapshot
   * (`driver_id` / `conductor_id`), or an **active** `RouteAssignment` for the
   * trip's route, in the operational role matching the account role,
   * effective on the trip's calendar day. The exact rule applied by trip
   * attendance, re-derived here over the same tenant-pinned tables.
   */
  async isCrewOfTrip(user: RequestUser, trip: Trip): Promise<boolean> {
    if (user.id === trip.driver_id || user.id === trip.conductor_id) {
      return true;
    }

    const role =
      user.role === UserRole.DRIVER ? RouteAssignmentRole.DRIVER : RouteAssignmentRole.CONDUCTOR;
    const candidates = await this.assignments.findAll({
      where: {
        school_id: user.school_id,
        route_id: trip.route_id,
        user_id: user.id,
        role,
        is_active: true,
      },
    });

    const tripDate = toDateOnly(trip.scheduled_start_at);
    return candidates.some((candidate) => coversDate(candidate, tripDate));
  }

  /**
   * True when the parent has at least one **active** `StudentGuardian` link
   * to an active student whose home stop belongs to the trip's route — the
   * same manifest derivation trip attendance uses.
   */
  /**
   * Route ids a parent may observe: every route that currently carries an
   * active linked child's home stop. Used by trip listing so a parent never
   * receives another family's runs.
   */
  async getParentObservableRouteIds(user: RequestUser): Promise<string[]> {
    if (user.role !== UserRole.PARENT) {
      return [];
    }

    const links = await this.guardians.findAll({
      where: { school_id: user.school_id, user_id: user.id, is_active: true },
    });
    if (links.length === 0) {
      return [];
    }

    const students = await this.students.findAll({
      where: {
        school_id: user.school_id,
        is_active: true,
        id: { [Op.in]: links.map((link) => link.student_id) },
      },
      attributes: ['id', 'home_stop_id'],
    });
    const stopIds = students
      .map((student) => student.home_stop_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (stopIds.length === 0) {
      return [];
    }

    const stops = await this.stops.findAll({
      where: { school_id: user.school_id, id: { [Op.in]: stopIds } },
      attributes: ['id', 'route_id'],
    });
    return [...new Set(stops.map((stop) => stop.route_id))];
  }

  async hasLinkedChildOnTrip(user: RequestUser, trip: Trip): Promise<boolean> {
    const links = await this.guardians.findAll({
      where: { school_id: user.school_id, user_id: user.id, is_active: true },
    });
    if (links.length === 0) {
      return false;
    }

    const stops = await this.stops.findAll({
      where: { school_id: user.school_id, route_id: trip.route_id },
      attributes: ['id'],
    });
    if (stops.length === 0) {
      return false;
    }

    const ownStudentIds = new Set(links.map((link) => link.student_id));
    const students = await this.students.findAll({
      where: {
        school_id: user.school_id,
        is_active: true,
        home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
      },
      attributes: ['id'],
    });

    return students.some((student) => ownStudentIds.has(student.id));
  }

  // ---------------------------------------------------------------------
  // REST reads
  // ---------------------------------------------------------------------

  /** `GET /api/v1/trips/:tripId/location` — the latest known position. */
  async getLatestLocation(actor: RequestUser, tripId: string): Promise<TripLocationLatestResponse> {
    const trip = await this.resolveTripForReader(actor, tripId);
    const location = await this.findLatestLocationOrNull(trip.school_id, trip.id);
    if (!location) {
      throw new NotFoundException(LIVE_TRACKING_NO_LOCATION_MESSAGE);
    }

    return {
      ...this.toResponse(location),
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
    };
  }

  /**
   * `GET /api/v1/trips/:tripId/location/history` — chronological, bounded
   * fix history. The window is inclusive on both ends and the page is always
   * limited (`limit` defaults to 100 and never exceeds 500), so unlimited
   * history is impossible.
   */
  async getLocationHistory(
    actor: RequestUser,
    tripId: string,
    query: TripLocationHistoryQuery = {},
  ): Promise<TripLocationHistoryResponse> {
    const trip = await this.resolveTripForReader(actor, tripId);

    const parsed = tripLocationHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    const { from, to } = parsed.data;
    const limit = parsed.data.limit ?? DEFAULT_HISTORY_LIMIT;

    const where: Record<string, unknown> = {
      school_id: trip.school_id,
      trip_id: trip.id,
    };
    if (from !== undefined || to !== undefined) {
      const recordedAt: Record<string | symbol, unknown> = {};
      if (from !== undefined) recordedAt[Op.gte] = new Date(from);
      if (to !== undefined) recordedAt[Op.lte] = new Date(to);
      where.recorded_at = recordedAt;
    }

    const rows = await this.locations.findAll({
      where: where as WhereOptions,
      order: [
        ['recorded_at', 'ASC'],
        ['received_at', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    return {
      trip_id: trip.id,
      school_id: trip.school_id,
      items: rows.slice(0, limit).map((row) => this.toResponse(row)),
      has_more: hasMore,
    };
  }

  /**
   * The latest fix of an already-authorised trip as a response projection,
   * or `null` while it has never moved. Used by the gateway to seed a
   * joining socket with the current position.
   */
  async getLatestLocationResponse(
    schoolId: string,
    tripId: string,
  ): Promise<TripLocationResponse | null> {
    const location = await this.findLatestLocationOrNull(schoolId, tripId);
    return location ? this.toResponse(location) : null;
  }

  // ---------------------------------------------------------------------
  // Socket writes
  // ---------------------------------------------------------------------

  /**
   * Handles one `trip:location:update` from a crew device.
   *
   * Every failure mode returns a `rejected` ack (the socket stays connected);
   * only an accepted fix reaches the database. Out-of-order and duplicate
   * fixes are still persisted for the history — they simply never move the
   * live position backwards, because a fix only replaces the latest when its
   * `recorded_at` is newer (or equal with a later server receipt).
   */
  async recordLocation(
    user: RequestUser,
    rawPayload: unknown,
    context: { socketId?: string } = {},
  ): Promise<RecordLocationResult> {
    const reject = (tripId: string, reason: TripLocationUpdateAck['reason']) => ({
      ack: { status: 'rejected' as const, trip_id: tripId, reason },
    });

    const parse = tripLocationUpdateSchema.safeParse(rawPayload);
    if (!parse.success) {
      return reject(extractTripId(rawPayload) ?? 'unknown', 'invalid_payload');
    }
    const payload = parse.data;

    if (user.role !== UserRole.DRIVER && user.role !== UserRole.CONDUCTOR) {
      return reject(payload.trip_id, 'unauthorized');
    }

    const trip = await this.trips.findOne({
      where: { id: payload.trip_id, school_id: user.school_id },
    });
    if (!trip) {
      return reject(payload.trip_id, 'trip_not_found');
    }

    if (!(await this.isCrewOfTrip(user, trip))) {
      return reject(payload.trip_id, 'unauthorized');
    }

    if (!isTripTrackingActive(trip.status)) {
      return reject(payload.trip_id, 'trip_not_open');
    }

    const now = new Date();
    const nowMs = now.getTime();
    const recordedMs = new Date(payload.recorded_at).getTime();

    if (Number.isNaN(recordedMs)) {
      return reject(payload.trip_id, 'invalid_timestamp');
    }
    if (recordedMs > nowMs + this.config.maxFutureSkewMs) {
      return reject(payload.trip_id, 'future_timestamp');
    }
    if (recordedMs < nowMs - this.config.maxPastSkewMs) {
      return reject(payload.trip_id, 'invalid_timestamp');
    }

    const throttleKey = `${trip.id}:${user.id}`;
    const throttle = this.throttles.get(throttleKey);
    if (throttle && nowMs - throttle.lastAcceptedAt < this.config.gpsMinIntervalMs) {
      return reject(payload.trip_id, 'throttled');
    }

    const current = await this.getLatestForTrip(trip);
    const replacesLatest =
      current === null ||
      recordedMs > current.recordedAt ||
      (recordedMs === current.recordedAt && nowMs >= current.receivedAt);

    const location = await this.locations.create({
      school_id: trip.school_id,
      trip_id: trip.id,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy ?? null,
      speed: payload.speed ?? null,
      heading: payload.heading ?? null,
      recorded_at: new Date(recordedMs),
      received_at: now,
    });

    this.throttles.set(throttleKey, {
      lastAcceptedAt: nowMs,
      socketId: context.socketId ?? '',
    });

    const ack: TripLocationUpdateAck = {
      status: 'accepted',
      trip_id: trip.id,
      received_at: now.toISOString(),
      stale: !replacesLatest,
    };

    if (!replacesLatest) {
      return { ack };
    }

    this.latestCache.set(trip.id, {
      recordedAt: recordedMs,
      receivedAt: nowMs,
      id: location.id,
    });

    const payloadOut: TripLocationUpdateEvent = {
      trip_id: trip.id,
      school_id: trip.school_id,
      trip_status: trip.status,
      tracking_state: getTripTrackingState(trip.status),
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy ?? null,
      speed: payload.speed ?? null,
      heading: payload.heading ?? null,
      recorded_at: payload.recorded_at,
      received_at: now.toISOString(),
    };
    this.emitToTrip(trip.id, LIVE_TRACKING_EVENTS.locationUpdate, payloadOut);

    // Task 22: geofence evaluation for stop arrivals. Best-effort by design
    // — it can never reject or delay an already-accepted GPS fix.
    await this.evaluateStopArrivals(trip, location);

    return {
      ack,
      broadcast: { event: LIVE_TRACKING_EVENTS.locationUpdate, payload: payloadOut },
    };
  }

  // ---------------------------------------------------------------------
  // Lifecycle integration
  // ---------------------------------------------------------------------

  /**
   * Notified by `TripsService` after every lifecycle transition (and after a
   * soft delete). Emits, to the trip's room:
   *
   * - `trip:tracking:started` the first time the trip enters the active
   *   window (`BOARDING` / `IN_PROGRESS`) — crew devices may begin sending;
   * - `trip:tracking:stopped` when the trip becomes terminal — no further
   *   fixes are ever accepted, and the in-memory state is dropped.
   *
   * The latest recorded location remains readable through the REST endpoints
   * after a stop; only *new* writes are refused.
   */
  async onTripStatusChanged(
    trip: Pick<Trip, 'id' | 'school_id' | 'status'>,
    options: { deleted?: boolean } = {},
  ): Promise<TripTrackingTransitionResult> {
    const previous = this.trackingStates.get(trip.id);
    const state = getTripTrackingState(trip.status);
    const at = new Date().toISOString();

    let result: TripTrackingTransitionResult = { event: null, payload: null };

    if (state === 'active' && previous !== 'active') {
      const payload: TripTrackingStartedEvent = {
        trip_id: trip.id,
        school_id: trip.school_id,
        trip_status: trip.status,
        tracking_state: state,
        at,
      };
      result = { event: LIVE_TRACKING_EVENTS.trackingStarted, payload };
    } else if (state === 'stopped') {
      const payload: TripTrackingStoppedEvent = {
        trip_id: trip.id,
        school_id: trip.school_id,
        trip_status: trip.status,
        tracking_state: state,
        reason: options.deleted
          ? 'deleted'
          : trip.status === TripStatus.CANCELLED
            ? 'cancelled'
            : 'completed',
        at,
      };
      result = { event: LIVE_TRACKING_EVENTS.trackingStopped, payload };
    }

    this.trackingStates.set(trip.id, state);
    if (state === 'stopped') {
      this.resetForTrip(trip.id);
      // Task 22: drop the per-process arrival memory of the terminal trip —
      // no further arrivals can be generated for it anyway.
      this.arrivals.resetForTrip(trip.id);
    }

    if (result.event !== null && result.payload !== null) {
      this.emitToTrip(trip.id, result.event, result.payload);
    }

    return result;
  }

  /**
   * Drops the in-memory throttle entry of a disconnected socket (best effort
   * garbage collection — the entry is overwritten by the next accepted fix
   * regardless).
   */
  cleanupSocket(socketId: string): void {
    for (const [key, entry] of this.throttles) {
      if (entry.socketId === socketId) {
        this.throttles.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /** REST authorization: the trip inside the caller's tenant plus the observer rule. */
  private async resolveTripForReader(actor: RequestUser, tripId: string): Promise<Trip> {
    const auth = await this.authorizeObservation(actor, tripId);
    if (!auth.ok) {
      // Unknown id, other tenant and "not my trip" are intentionally the
      // same generic 404 — probing can never confirm existence.
      throw new NotFoundException(LIVE_TRACKING_TRIP_NOT_FOUND_MESSAGE);
    }
    return auth.trip;
  }

  /** Latest fix of the trip, or `null` while it has never moved. */
  private async findLatestLocationOrNull(
    schoolId: string,
    tripId: string,
  ): Promise<TripLocation | null> {
    return this.locations.findOne({
      where: { school_id: schoolId, trip_id: tripId },
      order: [
        ['recorded_at', 'DESC'],
        ['received_at', 'DESC'],
        ['id', 'ASC'],
      ],
      limit: 1,
    });
  }

  /** In-memory latest, lazily filled from the database on first use. */
  private async getLatestForTrip(trip: Trip): Promise<LatestFix | null> {
    const cached = this.latestCache.get(trip.id);
    if (cached) {
      return cached;
    }

    const row = await this.findLatestLocationOrNull(trip.school_id, trip.id);
    if (!row) {
      return null;
    }

    const fix: LatestFix = {
      recordedAt: toDate(row.recorded_at).getTime(),
      receivedAt: toDate(row.received_at).getTime(),
      id: row.id,
    };
    this.latestCache.set(trip.id, fix);
    return fix;
  }

  /** Clears the per-trip in-memory state once the trip is terminal. */
  private resetForTrip(tripId: string): void {
    this.latestCache.delete(tripId);
    for (const key of this.throttles.keys()) {
      if (key.startsWith(`${tripId}:`)) {
        this.throttles.delete(key);
      }
    }
  }

  /**
   * Runs the Task 22 geofence/arrival pipeline for an accepted *latest* fix.
   * Deliberately best-effort: any failure is logged here (the arrivals
   * service itself also swallows its own errors) and can never reject the
   * already-persisted fix.
   */
  private async evaluateStopArrivals(trip: Trip, location: TripLocation): Promise<void> {
    try {
      await this.arrivals.onAcceptedFix(trip, location);
    } catch (error) {
      this.logger.error(
        `Stop arrival evaluation failed for trip ${trip.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  private emitToTrip(tripId: string, event: LiveTrackingEvent, payload: unknown): void {
    // Without an attached broadcaster (unit tests, gateway not yet up) the
    // event is simply dropped — persistence and the REST reads are unaffected.
    this.broadcaster?.(liveTrackingRoomName(tripId), event, payload);
  }

  /** Explicit projection — ORM internals and associations never leak. */
  toResponse(location: TripLocation): TripLocationResponse {
    return {
      id: location.id,
      school_id: location.school_id,
      trip_id: location.trip_id,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      speed: location.speed ?? null,
      heading: location.heading ?? null,
      recorded_at: toDate(location.recorded_at).toISOString(),
      received_at: toDate(location.received_at).toISOString(),
    };
  }
}

/** The trip id carried by a raw socket payload, if it is a non-empty string. */
export function extractTripId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = (payload as Record<string, unknown>).trip_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Inclusive UTC-day window applied to `scheduled_start_at`. */
function toDateOnly(value: Date): string {
  return toDate(value).toISOString().slice(0, 10);
}

/** Tenant-local roster periods are compared on the trip's UTC calendar day. */
function coversDate(assignment: RouteAssignment, date: string): boolean {
  const from = normalizeDateOnly(assignment.effective_from);
  const to = assignment.effective_to == null ? null : normalizeDateOnly(assignment.effective_to);
  return from <= date && (to === null || date <= to);
}

function normalizeDateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}
