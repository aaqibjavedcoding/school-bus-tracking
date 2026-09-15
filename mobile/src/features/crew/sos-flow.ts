import { ApiClientError } from '@school-bus-tracking/api-client';
import { generateIdempotencyKey } from '../../lib/idempotency.ts';

/**
 * Delivery state machine for one crew SOS session (Phase 2).
 *
 * Pure and React-free so `sos-flow.spec.ts` can pin the two guarantees the
 * acceptance criteria call out:
 *
 * 1. **No duplicate alert on double-press:** every retry of the *same*
 *    logical alert reuses the same idempotency key. The key rotates only
 *    after the server confirmed the alert (`markSent`) — a dropped response,
 *    a flaky network or the client's own 401-refresh replay all dedupe
 *    server-side instead of recording a second SOS. (Same contract the
 *    SosPanel has honoured since Task 44; here it is extracted so it can be
 *    tested and shared by the SOS tab and the trip-screen button.)
 *
 * 2. **Offline is visible, not silent:** a network-level failure marks the
 *    attempt `queued` (the UI shows "queued ⏳ …"), the key stays, and the
 *    same key is handed back on the automatic reconnect retry. The screen
 *    decides queueability with the attendance queue's own
 *    `shouldQueueAfterError` rule (see `offline/useOfflineAction.ts`) — this
 *    module mirrors it below only because that file imports native
 *    AsyncStorage and must stay unloadable in plain-Node specs. The component
 *    always calls the shared one; CI's offline simulation suite pins it.
 *
 * Deliberate scope note: unlike attendance, a queued SOS lives in memory
 * (session-scoped) because the durable offline queue is attendance-only by
 * design (`features/crew/offline` is zero-touch in Phase 2). Documented in
 * `docs/mobile-ux.md`.
 */

export type SosDeliveryStatus =
  /** Nothing in flight; the button is armed. */
  | 'idle'
  /** A request (or its retry) is on the wire. */
  | 'sending'
  /** Server confirmed the alert; the key has rotated for the next alert. */
  | 'sent'
  /** Not deliverable yet (offline) — will retry with the same key. */
  | 'queued'
  /** The server rejected the alert (4xx); the reason is surfaced in UI. */
  | 'failed';

export class SosSession {
  private key: string;
  private status: SosDeliveryStatus = 'idle';
  private readonly newKey: () => string;

  constructor(newKey: () => string = generateIdempotencyKey) {
    this.newKey = newKey;
    this.key = newKey();
  }

  /** Key every request of the current alert must carry. */
  get idempotencyKey(): string {
    return this.key;
  }

  get deliveryStatus(): SosDeliveryStatus {
    return this.status;
  }

  /**
   * Start (or retry) the current alert. Returns the idempotency key to send:
   * the SAME key until an attempt is confirmed, so a double-press or a
   * reconnect replay can never create a second emergency record.
   */
  beginAttempt(): string {
    this.status = 'sending';
    return this.key;
  }

  /** Server accepted the alert: rotate the key for the *next* alert. */
  markSent(): void {
    this.status = 'sent';
    this.key = this.newKey();
  }

  /** Offline (or unknown-reachability): stay on this key, wait to retry. */
  markQueued(): void {
    this.status = 'queued';
  }

  /** The server answered and refused: surfaced to the user, key retained
   *  (the next press retries the same logical alert — parity with Task 44). */
  markFailed(): void {
    this.status = 'failed';
  }

  /** True when the attempt ended in a state that must retry by itself. */
  get needsRetry(): boolean {
    return this.status === 'queued';
  }
}

/**
 * Mirror of `shouldQueueAfterError` (`offline/useOfflineAction.ts`): only
 * failures where it is *unknown* whether the server applied the request are
 * worth queueing — a 4xx answer means the server decided, and queueing would
 * just replay the same rejection. The SosPanel calls the shared original;
 * this copy exists for the pure spec (see the module note above).
 */
export function isQueueableSosError(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    return error.status === 0 || error.status === 429 || error.status >= 500;
  }
  return error instanceof Error;
}
