/**
 * Client-side idempotency keys for safely retryable mutations.
 *
 * The API deduplicates critical mutations (SOS, attendance board/drop, trip
 * status, GPS fixes) on the `x-idempotency-key` header: replays with the same
 * key return the original response without re-executing. The key must be
 * unique per *logical operation* — one UUID per SOS alert, per offline-queue
 * item, per GPS fix.
 *
 * This module is deliberately free of native imports so it stays loadable in
 * the plain-Node unit tests.
 */

/** Header the API deduplicates critical mutations on. */
export const IDEMPOTENCY_HEADER = 'x-idempotency-key';

/**
 * Generates a UUID v4 key.
 *
 * Prefers `crypto.randomUUID` when the runtime provides it (modern React
 * Native / Hermes with the polyfill, browsers, Node ≥ 14.17) and falls back
 * to `Math.random` otherwise — the same fallback the offline attendance
 * queue has always used.
 */
export function generateIdempotencyKey(): string {
  const cryptoRef = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
    | undefined;

  if (typeof cryptoRef?.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }

  if (typeof cryptoRef?.getRandomValues === 'function') {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
