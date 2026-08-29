import {
  LIVE_TRACKING_EVENTS,
  type TrackingJoinAck,
  type TripLocationUpdateAck,
  type TripLocationUpdatePayload,
} from '@school-bus-tracking/shared-types';
import { isValidTripLocationUpdatePayload } from './fix-mapping';

/**
 * Socket transport for one driver's GPS fixes on one trip room.
 *
 * Rules inherited from the backend contract (see `live-tracking.gateway.ts`):
 *
 * - Room membership must be re-requested after every (re)connect — the server
 *   never trusts a stale join, and neither does this client (`generation`
 *   counting).
 * - GPS updates are fire-with-ack only; the ack is the source of truth for
 *   `accepted`/`rejected` (+ reason). We never optimistically claim a fix
 *   landed.
 * - Only one update is ever in flight: newer fixes supersede pending older
 *   ones, which keeps the mobile side far below the server throttle window
 *   (2.5 s) and prevents retry storms. This is a *transport* concern, not a
 *   business rule; the server still throttles/dedupes authoritatively.
 */

export type SenderState =
  | 'idle'
  | 'joining'
  | 'ready' // joined, waiting for the first accepted fix
  | 'streaming' // at least one fix accepted for this room generation
  | 'denied' // join refused (unauthorized / trip closed / …)
  | 'disconnected';

export interface TripFixSenderOptions {
  tripId: string;
  /** Emits over the namespace socket; matches `Socket['emit']` closely enough. */
  emit: (event: string, payload: unknown, ack?: (response: unknown) => void) => void;
  /** Milliseconds to wait for an ack before treating the send as failed. */
  ackTimeoutMs?: number;
  now?: () => number;
}

export class TripFixSender {
  private state: SenderState = 'idle';
  private joinAck: TrackingJoinAck | null = null;
  private inFlight = false;
  private pendingLatest: TripLocationUpdatePayload | null = null;
  private lastRejection: TripLocationUpdateAck['reason'] = undefined;
  private readonly listeners = new Set<() => void>();
  private readonly ackTimeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly options: TripFixSenderOptions) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 8_000;
    this.now = options.now ?? Date.now;
  }

  get senderState(): SenderState {
    return this.state;
  }

  get joinDenialReason(): TrackingJoinAck['reason'] | null {
    return this.joinAck?.reason ?? null;
  }

  get lastRejectionReason(): TripLocationUpdateAck['reason'] | undefined {
    return this.lastRejection;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Request room membership for the trip; resolves with the server's verdict. */
  join(): Promise<TrackingJoinAck> {
    this.setState('joining');
    this.joinAck = null;
    return this.emitWithAck<TrackingJoinAck>(LIVE_TRACKING_EVENTS.join, {
      trip_id: this.options.tripId,
    }).then((ack) => {
      this.joinAck = ack;
      if (ack && ack.status === 'joined') {
        this.setState(this.hasAcceptedFix ? 'streaming' : 'ready');
      } else {
        this.setState('denied');
      }
      return ack;
    });
  }

  leave(): void {
    // The server drops rooms per socket; leave is cooperative only.
    this.options.emit(LIVE_TRACKING_EVENTS.leave, { trip_id: this.options.tripId });
    this.hasAcceptedFix = false;
    this.setState('idle');
  }

  private hasAcceptedFix = false;

  /** After a reconnect: re-join the room (rooms do not survive disconnects). */
  rejoin(): Promise<TrackingJoinAck> {
    return this.join();
  }

  /**
   * Send one fix. Returns the server ack, or `null` when the fix was coalesced
   * (a newer fix replaced it) or the socket did not answer in time.
   */
  async send(payload: TripLocationUpdatePayload): Promise<TripLocationUpdateAck | null> {
    if (this.state !== 'ready' && this.state !== 'streaming') {
      // Do not queue blind: joining is a single round trip, and a fix while
      // disconnected is dropped (the OS/position keeps producing newer ones).
      if (this.state === 'disconnected' || this.state === 'denied' || this.state === 'idle') {
        return null;
      }
    }
    if (!isValidTripLocationUpdatePayload(payload)) {
      return { status: 'rejected', trip_id: payload.trip_id, reason: 'invalid_payload' };
    }

    if (this.inFlight) {
      // Supersede the queued fix: only the newest position matters.
      this.pendingLatest = payload;
      return null;
    }

    this.inFlight = true;
    try {
      let current: TripLocationUpdatePayload | null = payload;
      let result: TripLocationUpdateAck | null = null;
      while (current) {
        const sendTarget = current;
        current = null;
        result = await this.emitWithAck<TripLocationUpdateAck>(
          LIVE_TRACKING_EVENTS.locationUpdate,
          sendTarget,
        );
        const queued = this.pendingLatest;
        this.pendingLatest = null;
        if (queued) {
          current = queued;
        }
      }
      if (result?.status === 'accepted' && !result.stale) {
        this.hasAcceptedFix = true;
        if (this.state !== 'streaming') {
          this.setState('streaming');
        }
      }
      this.lastRejection = result?.status === 'rejected' ? result.reason : undefined;
      return result;
    } finally {
      this.inFlight = false;
    }
  }

  /** Called by the tracker when the underlying socket drops. */
  markDisconnected(): void {
    this.hasAcceptedFix = false;
    this.inFlight = false;
    this.pendingLatest = null;
    this.setState('disconnected');
  }

  reset(): void {
    this.hasAcceptedFix = false;
    this.inFlight = false;
    this.pendingLatest = null;
    this.joinAck = null;
    this.setState('idle');
  }

  private emitWithAck<T>(event: string, payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timeout waiting for server ack of "${event}"`));
        }
      }, this.ackTimeoutMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
      const finish = (value: T) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      };
      try {
        this.options.emit(event, payload, (response: unknown) => {
          finish((response ?? { status: 'rejected', trip_id: this.options.tripId }) as T);
        });
      } catch (error) {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  }

  private setState(next: SenderState): void {
    if (this.state !== next) {
      this.state = next;
      this.listeners.forEach((listener) => listener());
    }
  }

  /** Exposed for the tracker's clock-skew free tests. */
  get currentTime(): number {
    return this.now();
  }
}
