import type { KeyValueStorage } from '../storage/secure-store';
import {
  deriveStatus,
  statusForPermission,
  type GpsPermissionOutcome,
  type GpsStatus,
} from './status';
import { toTripLocationUpdatePayload, GPS_REJECTION_MESSAGES } from './fix-mapping';
import { TripFixSender } from './fix-sender';
import type { GpsLocationAdapter, LocationTaskPayload } from './location-adapter';

/**
 * The driver's GPS tracker: orchestrates permissions → OS background task →
 * socket room → server-acked fixes, and owns the *displayed* status.
 *
 * Hard rules from the product brief:
 *
 * - Never fake tracking. `live` requires an `accepted` ack from the backend;
 *   permission/service/network problems surface as their own statuses.
 * - No business rules duplicated client-side: trip openness, throttling,
 *   timestamp validity and geofence/ETA logic all stay on the server — the
 *   tracker only reacts to the acks it receives.
 * - Nothing is queued silently while offline: fixes are dropped (the device
 *   keeps producing newer ones) and the status shows OFFLINE, so the driver
 *   always knows whether parents see the bus.
 */

export interface TrackerSocketLike {
  connected: boolean;
  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

export interface GpsTrackerDeps {
  location: GpsLocationAdapter;
  getSocket(): TrackerSocketLike;
  isOnline(): boolean;
  onNetworkChange(listener: (online: boolean) => void): () => void;
  storage: KeyValueStorage;
}

export interface GpsTrackerSnapshot {
  status: GpsStatus;
  tripId: string | null;
  /** Human hint for the UI (permission guidance, server rejection reason…). */
  message: string | null;
  /** True when the OS also granted background ("always") location. */
  backgroundGranted: boolean;
  lastAcceptedAt: string | null;
}

export class GpsTracker {
  private sender: TripFixSender | null = null;
  private snapshot: GpsTrackerSnapshot = {
    status: 'stopped',
    tripId: null,
    message: null,
    backgroundGranted: false,
    lastAcceptedAt: null,
  };
  private permission: GpsPermissionOutcome | null = null;
  private started = false;
  private startedTripId: string | null = null;
  private networkListener: (() => void) | null = null;
  private socketListeners: {
    socket: TrackerSocketLike;
    connect(): void;
    disconnect(): void;
  } | null = null;
  private readonly listeners = new Set<() => void>();
  private handling = Promise.resolve();

  constructor(private readonly deps: GpsTrackerDeps) {}

  getSnapshot(): GpsTrackerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Begin sharing GPS for a trip. Idempotent while already tracking that trip,
   * which protects against double-taps and screen re-mounts.
   */
  async start(tripId: string): Promise<void> {
    if (this.started && this.startedTripId === tripId) {
      return;
    }
    if (this.started) {
      await this.stop();
    }

    this.started = true;
    this.startedTripId = tripId;
    this.update({ tripId, status: 'starting', message: null, lastAcceptedAt: null });
    await this.deps.storage.set('gps_active_trip', tripId);

    this.permission = await this.checkPermissions();
    this.update({ backgroundGranted: this.permission.kind === 'granted' });

    const derived = statusForPermission(this.permission);
    if (this.permission.kind === 'denied') {
      this.update({
        status: 'permission-required',
        message:
          'Location permission is required to share the bus position. Enable it in Settings, then press Start GPS again.',
      });
      // Keep the OS task off but leave the UI able to resume after Settings.
      return;
    }
    if (this.permission.kind === 'services-off') {
      this.update({
        status: 'waiting',
        message: 'Location services are switched off. Turn on GPS to start sharing.',
      });
      return;
    }
    if (this.permission.kind === 'foreground-only') {
      this.update({
        backgroundGranted: false,
        message:
          'Background location was not granted — GPS keeps streaming only while the app is open. The status reflects that.',
      });
    }

    // Register the task executor before starting updates so a very early
    // emission still lands in a live handler.
    await this.deps.location.ensureTaskDefined((payload) => this.handleTaskEvent(payload));
    try {
      await this.deps.location.startBackgroundUpdates();
    } catch (error) {
      this.started = false;
      this.startedTripId = null;
      await this.deps.storage.set('gps_active_trip', null);
      this.update({
        status: 'offline',
        message: `Could not start background tracking: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
      return;
    }

    const socket = this.deps.getSocket();
    this.sender = new TripFixSender({
      tripId,
      emit: (event, payload, ack) => socket.emit(event, payload, ack),
    });
    this.sender.subscribe(() => this.recompute());

    this.wireSocket(socket);
    this.networkListener = this.deps.onNetworkChange(() => this.recompute());

    try {
      const ack = await this.sender.join();
      if (ack.status !== 'joined') {
        this.update({
          status: ack.reason === 'trip_not_open' ? 'waiting' : 'offline',
          message:
            ack.reason === 'trip_not_open'
              ? 'Tracking waits until the trip starts boarding. Start the trip (or the driver does) and updates flow automatically.'
              : `The tracking server refused the join (${ack.reason ?? 'unknown'}).`,
        });
      }
    } catch {
      this.update({
        status: this.deps.isOnline() ? 'offline' : 'offline',
        message: 'Live tracking connection is down.',
      });
    }

    // Warm start: a fresh cached OS fix (if any) is sent immediately so
    // parents see movement without waiting for the next tick.
    const warm = await this.deps.location.getLastKnownFix();
    if (warm) {
      await this.sendFix(warm);
    }

    if (derived === 'starting') {
      this.recompute();
    }
  }

  async stop(): Promise<void> {
    this.started = false;
    this.startedTripId = null;
    this.permission = null;
    try {
      await this.deps.location.stopBackgroundUpdates();
    } finally {
      this.sender?.leave();
      this.sender = null;
      this.teardownSocket();
      this.networkListener?.();
      this.networkListener = null;
      await this.deps.storage.set('gps_active_trip', null);
      this.update({
        status: 'stopped',
        tripId: null,
        message: null,
        backgroundGranted: false,
        lastAcceptedAt: null,
      });
    }
  }

  /** Re-evaluate after app resumes / user returns from Settings. */
  async refresh(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.permission = await this.checkPermissions();
    if (
      (this.permission.kind === 'granted' || this.permission.kind === 'foreground-only') &&
      this.sender
    ) {
      // Permission may have arrived while we sat in permission-required: make
      // sure the OS task is actually running, then re-join.
      await this.deps.location.ensureTaskDefined((payload) => this.handleTaskEvent(payload));
      try {
        await this.deps.location.startBackgroundUpdates();
      } catch {
        /* already running is the expected state here */
      }
      try {
        await this.sender.rejoin();
      } catch {
        /* socket reconnect re-joins */
      }
    }
    this.recompute();
  }

  /**
   * Entry point of the OS background task (and of warm-context emissions).
   * Events are processed strictly one-at-a-time; the sender coalesces so a
   * slow socket can never grow an unbounded backlog.
   */
  async handleTaskEvent(payload: LocationTaskPayload): Promise<void> {
    const previous = this.handling;
    this.handling = previous
      .then(async () => {
        if (payload.error) {
          this.update({
            message: `Device location error: ${payload.error.message}`,
          });
          return;
        }
        const fixes = payload.locations ?? [];
        const latest = fixes[fixes.length - 1];
        if (!latest) {
          return;
        }
        if (!this.sender) {
          // Cold headless relaunch: rebuild the in-memory session around the
          // persisted active trip before sending.
          await this.resumeFromPersistence();
        }
        if (!this.sender) {
          return;
        }
        await this.sendFix(latest);
      })
      .catch(() => {
        /* never let a task rejection crash the OS callback */
      });
    return this.handling;
  }

  private async sendFix(fix: Parameters<typeof toTripLocationUpdatePayload>[1]): Promise<void> {
    if (!this.sender || !this.startedTripId) {
      return;
    }
    const payload = toTripLocationUpdatePayload(this.startedTripId, fix);
    try {
      const ack = await this.sender.send(payload);
      if (ack?.status === 'accepted') {
        this.update({
          lastAcceptedAt: ack.received_at ?? new Date().toISOString(),
          message: ack.stale ? 'A newer position is already on the server.' : null,
        });
      } else if (ack?.status === 'rejected') {
        const reason = ack.reason ?? 'invalid_payload';
        this.update({ message: GPS_REJECTION_MESSAGES[reason] });
      }
      this.recompute();
    } catch {
      this.update({ message: 'The live-tracking socket did not answer.' });
      this.recompute();
    }
  }

  /**
   * A cold background relaunch (process was killed, iOS restarted the task)
   * rehydrates the tracker from persisted state: active trip + a fresh socket
   * joined through the re-bootstrapped session.
   */
  async resumeFromPersistence(): Promise<void> {
    if (this.sender) {
      return;
    }
    const tripId = this.deps.storage.get('gps_active_trip');
    if (!tripId) {
      return;
    }
    this.started = true;
    this.startedTripId = tripId;
    this.update({ tripId });
    this.permission = await this.checkPermissions();
    const socket = this.deps.getSocket();
    this.sender = new TripFixSender({
      tripId,
      emit: (event, payload, ack) => socket.emit(event, payload, ack),
    });
    this.sender.subscribe(() => this.recompute());
    this.wireSocket(socket);
    this.networkListener = this.deps.onNetworkChange(() => this.recompute());
    try {
      await this.sender.join();
    } catch {
      /* the reconnect path retries the join */
    }
    this.recompute();
  }

  private async checkPermissions(): Promise<GpsPermissionOutcome> {
    const foreground = await this.deps.location.requestForegroundPermission();
    if (!foreground) {
      return { kind: 'denied' };
    }
    const services = await this.deps.location.hasServicesEnabled().catch(() => true);
    if (!services) {
      return { kind: 'services-off' };
    }
    const background = await this.deps.location.requestBackgroundPermission();
    return { kind: background ? 'granted' : 'foreground-only', background };
  }

  private wireSocket(socket: TrackerSocketLike): void {
    const connect = (): void => {
      void this.sender?.rejoin().catch(() => undefined);
      this.recompute();
    };
    const disconnect = (): void => {
      this.sender?.markDisconnected();
      this.recompute();
    };
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    this.socketListeners = { socket, connect, disconnect };
  }

  private teardownSocket(): void {
    if (!this.socketListeners) {
      return;
    }
    const { socket, connect, disconnect } = this.socketListeners;
    socket.off('connect', connect);
    socket.off('disconnect', disconnect);
    this.socketListeners = null;
  }

  private recompute(): void {
    const socket = this.started && this.sender ? this.deps.getSocket() : null;
    const status = deriveStatus({
      started: this.started,
      permission: this.permission,
      socketConnected: Boolean(socket?.connected),
      networkOnline: this.deps.isOnline(),
      acceptedFix: Boolean(this.snapshot.lastAcceptedAt),
    });
    // 'live' only ever comes from a server-accepted fix — never assumed.
    this.update({ status: this.started ? status : 'stopped' });
  }

  private update(patch: Partial<GpsTrackerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
