/**
 * Cross-channel **presentation** de-duplication for one logical notification.
 *
 * A parent notification reaches the phone over two independent rails:
 *
 * 1. the `/notifications` Socket.IO namespace (`notification:new`), which the
 *    parent layout renders as an in-app banner;
 * 2. FCM/APNs, whose foreground handler (`push-notifications.native.ts`) also
 *    asks the OS to show a banner and play a sound.
 *
 * Whichever arrives first used to win and the second one duplicated: the same
 * "Bus is near your stop" appeared twice, with two sounds. Both rails carry the
 * same stable notification id — the socket event's `notification_id` and the
 * push payload's `data.id` are the *same* `notifications` row id (see
 * `web/src/server/modules/notifications/outbox/delivery-worker.ts` →
 * `pushDataPayload`) — so one claim per id is enough to present exactly once.
 *
 * What this module deliberately does **not** do:
 *
 * - it never suppresses a *distinct* event: a different id is a different
 *   notification and is always presented;
 * - it never touches inbox persistence or the unread count (the socket event
 *   still updates state; only the banner/sound is deduplicated);
 * - it never suppresses background / locked-screen delivery: the OS renders an
 *   FCM notification message before any JS handler runs, and this claim only
 *   happens on the two foreground paths;
 * - it cannot promise exactly-once delivery across a crash boundary: the store
 *   is in-memory by design (a restart re-presents at most the newest event).
 *
 * Retention is **bounded**: at most {@link PRESENTATION_DEDUP_CAPACITY} ids,
 * each expiring after {@link PRESENTATION_DEDUP_TTL_MS}, oldest-first eviction.
 * The store is scoped to the signed-in account and cleared whenever the account
 * changes, so one tenant's ids can never suppress another's.
 */

/** Account/tenant the dedup store is scoped to. */
export interface PresentationAccount {
  userId: string;
  schoolId: string | null;
}

/** Hard cap on remembered ids — never an unbounded collection. */
export const PRESENTATION_DEDUP_CAPACITY = 200;

/**
 * How long an id is remembered. Two rails for one event arrive within
 * milliseconds of each other; ten minutes is far beyond any real overlap and
 * keeps the footprint tiny.
 */
export const PRESENTATION_DEDUP_TTL_MS = 10 * 60_000;

/** Which rail claimed the id — diagnostics and tests only. */
export type PresentationChannel = 'socket' | 'push';

interface SeenEntry {
  key: string;
  claimedAt: number;
  channel: PresentationChannel;
}

let account: PresentationAccount | null = null;
/** Insertion-ordered: the oldest entry is the first to be evicted. */
const seen = new Map<string, SeenEntry>();

function scopeKey(id: string): string {
  return account ? `${account.schoolId ?? 'no-school'}|${account.userId}|${id}` : id;
}

/**
 * Binds the store to the signed-in account.
 *
 * Any change (login, account switch, logout → `null`) drops every remembered
 * id: suppression state must never outlive the account it was collected for.
 */
export function setPresentationAccount(next: PresentationAccount | null): void {
  const same =
    (account === null && next === null) ||
    (account !== null &&
      next !== null &&
      account.userId === next.userId &&
      account.schoolId === next.schoolId);
  account = next ? { userId: next.userId, schoolId: next.schoolId ?? null } : null;
  if (!same) {
    seen.clear();
  }
}

/** The account the store is currently scoped to (`null` when signed out). */
export function getPresentationAccount(): PresentationAccount | null {
  return account;
}

/** Number of ids currently remembered (bounded by the capacity). */
export function presentationSeenCount(): number {
  return seen.size;
}

/** Test/diagnostic seam: forgets every id but keeps the account binding. */
export function resetPresentationDedup(): void {
  seen.clear();
}

/** Drops entries older than the TTL, then enforces the capacity bound. */
function prune(now: number): void {
  if (seen.size === 0) {
    return;
  }
  for (const [key, entry] of seen) {
    if (now - entry.claimedAt > PRESENTATION_DEDUP_TTL_MS) {
      seen.delete(key);
    }
  }
  while (seen.size >= PRESENTATION_DEDUP_CAPACITY) {
    const oldest = seen.keys().next();
    if (oldest.done === true) {
      break;
    }
    seen.delete(oldest.value);
  }
}

/**
 * Claims the right to present one notification id.
 *
 * Returns `true` for the **first** claim (present the banner / play the sound)
 * and `false` for every later claim of the same id (suppress it). An absent id
 * returns `true`: without a stable id there is nothing to deduplicate on, and
 * silently swallowing a real notification would be worse than a duplicate.
 */
export function claimNotificationPresentation(
  notificationId: string | null | undefined,
  options: { channel?: PresentationChannel; now?: number } = {},
): boolean {
  if (typeof notificationId !== 'string' || notificationId.trim().length === 0) {
    return true;
  }
  const now = options.now ?? Date.now();
  prune(now);

  const key = scopeKey(notificationId);
  const existing = seen.get(key);
  if (existing && now - existing.claimedAt <= PRESENTATION_DEDUP_TTL_MS) {
    return false;
  }

  seen.set(key, { key, claimedAt: now, channel: options.channel ?? 'socket' });
  return true;
}

/** True when this id was already presented (does not claim it). */
export function wasNotificationPresented(
  notificationId: string | null | undefined,
  options: { now?: number } = {},
): boolean {
  if (typeof notificationId !== 'string' || notificationId.trim().length === 0) {
    return false;
  }
  const now = options.now ?? Date.now();
  const entry = seen.get(scopeKey(notificationId));
  if (!entry) {
    return false;
  }
  return now - entry.claimedAt <= PRESENTATION_DEDUP_TTL_MS;
}
