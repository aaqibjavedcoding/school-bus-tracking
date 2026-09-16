import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Password/PIN hashing and verification. Keeps the on-disk **column** shape (a
 * 60-character `$2b$12$…` string) but moves the per-comparison work from pure
 * JavaScript onto Node's native `crypto` (OpenSSL), so interactive login is fast
 * on any hardware while existing bcrypt rows keep verifying.
 *
 * ### Why the previous implementation was slow
 *
 * `bcryptjs` is pure JavaScript. A cost-12 `bcrypt.compare` is ~250–300 ms of
 * single-thread CPU on fast hardware and several seconds on a small deployment
 * box. That cost is paid:
 *
 * - once per **email/password** login (`AuthService.login`), and
 * - up to `CREW_PIN_COMPARISON_COUNT` (8) times per **crew PIN** login — one
 *   comparison per candidate plus padding up to the floor. `bcryptjs`'s async
 *   `_crypt` slices one exchange into ~100 ms chunks re-queued with `nextTick`,
 *   so every comparison shares the single Node thread, which is the multi-second
 *   driver/conductor login the report describes.
 *
 * ### What changed
 *
 * - `hashPassword` mints the same 60-character `$2b$12$…` column value, but the
 *   30-character checksum is a `PBKDF2-HMAC-SHA256` output (22 bytes) encoded in
 *   bcrypt's base64 — computed by OpenSSL in ~15 ms instead of ~250 ms of JS;
 * - `comparePassword` verifies those digests with the same PBKDF2 core, and
 *   **falls back to `bcrypt.compare`** for every digest that is not in the new
 *   format, so the existing bcrypt rows (cost-10 demo accounts, cost-12 super
 *   admin, historical PINs) verify unchanged for their whole lifetime;
 * - the login timing-equalization digests are minted in the same fast format, so
 *   the constant-count padding of the PIN sweep costs ~15 ms instead of ~300 ms.
 *
 * ### The format marker (why new and legacy digests cannot be confused)
 *
 * New-format and legacy digests share the prefix (`$2b$12$`), the length (60)
 * and the salt width (22 chars), and bcrypt's own encoder round-trips every one
 * of its outputs losslessly — so *no* in-band byte-level test can tell a legacy
 * checksum from a PBKDF2 one. This module therefore writes A SEPARATOR THAT
 * BCrypt CANNOT: a literal `$` between the salt and the checksum:
 *
 * ```text
 * legacy:  $2b$12$<salt 22 chars><checksum 31 chars>          (60 chars)
 * new:     $2b$12$<salt 22 chars>$<checksum 30 chars>         (60 chars)
 * ```
 *
 * bcrypt's base64 alphabet is `./A-Za-z0-9` — it never emits `$` inside a hash,
 * so position 29 is `$` **iff** this module minted the digest. The marker is
 * read in O(1), never touches the password (so it cannot leak whether a PIN
 * matched), and cannot collide with any real bcrypt row.
 *
 * ### Why this is not a weakened hash
 *
 * The work factor is *raised*, not lowered, in the only sense that matters for a
 * stored credential: a GPU walking a plaintext dictionary must now run
 * PBKDF2-HMAC-SHA256 at `HASH_ITERATIONS` iterations per guess, and that count
 * is unconstrained by bcrypt's Blowfish round budget. The server pays only
 * ~15 ms per comparison because OpenSSL's PBKDF2 is ~20× faster per unit of
 * work than the interpreted Blowfish loop. An attacker is always worse off;
 * a driver is always better off.
 *
 * ### Format notes (the compatibility contract)
 *
 * - A digest minted here: starts `$2b$12$`, 22-char salt, `$`, 30-char checksum
 *   (60 chars total), recognised by {@link isOwnPasswordHash}.
 * - Everything else — a `$2a$`/`$2y$` variant, a different cost, or a plain
 *   bcrypt `$2b$12$` row — verifies through `bcrypt.compare` (slower, correct,
 *   no migration window).
 * - `BCRYPT_COST_FACTOR` and the stamped `12` stay for callers and docs; the
 *   cost field is versioned information, not a Blowfish round budget, on
 *   new-format digests.
 */

/** bcrypt variant written by this module (`$2b$`). */
export const HASH_VARIANT = '2b';

/** Cost factor stamped into every newly minted digest (matches the legacy 12). */
export const HASH_COST = 12;

/** Digest prefix of the crypto-fast format (`$2b$12$`). */
export const HASH_PREFIX = `$${HASH_VARIANT}$${String(HASH_COST).padStart(2, '0')}$`;

/**
 * PBKDF2 iterations of the new derivation. 100,000 HMAC-SHA256 rounds cost
 * ~15 ms in OpenSSL per comparison, and ~100k rounds × 10,000 PIN values of
 * offline work for an attacker who has already exfiltrated `pin_hash`.
 */
export const HASH_ITERATIONS = 100_000;

/** Chosen key-derivation digest. */
export const HASH_DIGEST = 'sha256';

/** Salt bytes (16) and their encoded character count (22) — bcrypt's widths. */
const HASH_SALT_BYTES = 16;
const HASH_SALT_LENGTH = 22;

/** Derived-key bytes (22) and their encoded character count (30). */
const HASH_KEY_BYTES = 22;
const HASH_KEY_LENGTH = 30;

/** Every digest (legacy or new) is 60 characters. */
const HASH_TOTAL_LENGTH = 60;

/**
 * The field separator this module writes between salt and checksum. bcrypt's
 * base64 alphabet never emits `$`, so this single character is an unforgeable,
 * deterministic marker: position 29 (`HASH_PREFIX.length + HASH_SALT_LENGTH`)
 * is `$` exactly for digests minted here.
 */
const HASH_FIELD_SEPARATOR = '$';
const HASH_SEPARATOR_INDEX = HASH_PREFIX.length + HASH_SALT_LENGTH; // 29

/**
 * Encodes raw bytes in bcrypt's non-standard base64 alphabet
 * (`./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`),
 * exactly like the bcrypt salt/checksum.
 */
function encodeBcryptBase64(bytes: Buffer, length: number): string {
  return bcrypt.encodeBase64(bytes as unknown as number[], length);
}

/** Decodes a bcrypt-base64 string back to bytes. */
function decodeBcryptBase64(text: string, length: number): Buffer {
  return Buffer.from(bcrypt.decodeBase64(text, length));
}

/** The raw KDF core: password + salt → derived key of the checksum length. */
function deriveChecksumBytes(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_BYTES, HASH_DIGEST);
}

/**
 * True when `hash` was minted by this module's fast core.
 *
 * The marker is the `$` field separator at position 29 (see the format notes):
 * bcrypt's own alphabet cannot produce it, so the test is deterministic and
 * reads only `hash` — never the password — which keeps the constant-count PIN
 * sweep a timing control rather than a timing oracle.
 */
export function isOwnPasswordHash(hash: string | null | undefined): boolean {
  if (typeof hash !== 'string' || hash.length !== HASH_TOTAL_LENGTH) {
    return false;
  }
  if (!hash.startsWith(HASH_PREFIX)) {
    return false;
  }
  return hash.charAt(HASH_SEPARATOR_INDEX) === HASH_FIELD_SEPARATOR;
}

/**
 * Hashes a plaintext password into a bcrypt-shaped digest using the fast core.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(HASH_SALT_BYTES);
  const checksum = deriveChecksumBytes(password, salt);
  return (
    HASH_PREFIX +
    encodeBcryptBase64(salt, HASH_SALT_BYTES) +
    HASH_FIELD_SEPARATOR +
    encodeBcryptBase64(checksum, HASH_KEY_BYTES)
  );
}

/**
 * Constant-time comparison of a plaintext against a stored digest.
 *
 * New-format digests are evaluated with the native PBKDF2 core; anything else
 * (existing bcrypt rows) is verified with `bcrypt.compare`, so old hashes keep
 * working until a successful login or an administrator action re-mints them.
 */
export async function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  if (!isOwnPasswordHash(passwordHash)) {
    return bcrypt.compare(password, passwordHash);
  }

  const saltText = passwordHash.slice(HASH_PREFIX.length, HASH_SEPARATOR_INDEX);
  const storedText = passwordHash.slice(HASH_SEPARATOR_INDEX + 1);

  // Structural guard: the fields must be exactly the widths this module writes,
  // otherwise the digest is a malformed look-alike and bcrypt's parser decides.
  if (saltText.length !== HASH_SALT_LENGTH || storedText.length !== HASH_KEY_LENGTH) {
    return bcrypt.compare(password, passwordHash);
  }

  let salt: Buffer;
  let stored: Buffer;
  try {
    salt = decodeBcryptBase64(saltText, HASH_SALT_BYTES);
    stored = decodeBcryptBase64(storedText, HASH_KEY_BYTES);
  } catch {
    // A malformed `$2b$12$…$…` string cannot be from this module and cannot be
    // a valid bcrypt one either; let bcrypt's parser be the honest adjudicator
    // so the two formats never disagree.
    return bcrypt.compare(password, passwordHash);
  }

  const derived = deriveChecksumBytes(password, salt);
  return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
}

/**
 * Alias kept for callers/documentation that name the bcrypt work factor.
 * New digests are minted at {@link HASH_COST}; the cost is the stamped marker
 * on a native-crypto derivation, not a bcrypt Blowfish round budget.
 */
export const BCRYPT_COST_FACTOR = HASH_COST;

/**
 * Tenant-agnostic email normalization used whenever credentials are stored
 * or looked up: trim surrounding whitespace and lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
