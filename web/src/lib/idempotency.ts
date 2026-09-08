/**
 * Client-side idempotency keys for safely retryable mutations.
 *
 * The API deduplicates critical mutations (SOS, attendance board/drop, trip
 * and emergency status transitions) on the `x-idempotency-key` header:
 * replays with the same key return the original response without
 * re-executing. The key must be unique per *logical operation* — one UUID per
 * composed SOS alert, per button press that commits a transition.
 */

/** Header the API deduplicates critical mutations on. */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';

/**
 * Generates a UUID v4 key. Prefers `crypto.randomUUID` (all supported
 * browsers and Node) with a `Math.random` fallback for non-secure contexts.
 */
export function generateIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  const hex = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      result += '-';
    } else if (i === 14) {
      result += '4';
    } else if (i === 19) {
      result += hex[(Math.random() * 4) | 8];
    } else {
      result += hex[(Math.random() * 16) | 0];
    }
  }
  return result;
}
