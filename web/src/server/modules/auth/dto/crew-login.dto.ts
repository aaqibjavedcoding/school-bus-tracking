import {
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import {
  CREW_LOGIN_METHODS,
  CREW_PAIRING_TOKEN_MAX_LENGTH,
  CREW_PIN_LENGTH,
  CREW_PIN_PATTERN,
  crewPinLoginSchema,
} from '@school-bus-tracking/validation';
import { CrewLoginRequest } from '@school-bus-tracking/shared-types';

import { UUID_OR_SCHOOL_CODE } from './login.dto';

const onPinBranch = (body: CrewLoginDto): boolean => body.method === 'pin';
const onQrBranch = (body: CrewLoginDto): boolean => body.method === 'qr';

/**
 * `POST /v1/auth/crew-login` request DTO.
 *
 * Deliberately a *flat superset* of the shared `CrewLoginRequest` union rather
 * than an `implements` of it: a class cannot implement a discriminated union,
 * and faking one silently loses the branch guarantees. The union is enforced in
 * two places instead, and both are pinned by `crew-login.dto.spec.ts`:
 *
 * 1. Here, with `@ValidateIf` keyed on `method`, so each branch requires its own
 *    fields and nothing else, and unknown fields are refused by the global
 *    `forbidNonWhitelisted` pipe.
 * 2. In {@link narrowCrewLoginDto}, which re-parses the result through
 *    `crewPinLoginSchema` — the same `.strict()` contract the mobile client
 *    validated against before it ever sent the request.
 *
 * Step 2 is not redundant, and the reason is worth stating precisely: because
 * `pin` and `pairing_token` are both *declared* here, `forbidNonWhitelisted`
 * cannot object to a body that mixes branches — a QR login carrying a `pin`
 * looks entirely whitelisted to class-validator. Only the strict schema sees it.
 */
export class CrewLoginDto {
  @IsIn(CREW_LOGIN_METHODS)
  method!: 'pin' | 'qr';

  // ── PIN branch ─────────────────────────────────────────────────────────────

  /**
   * The tenant, as its UUID or its human-friendly code — the same two forms
   * `POST /auth/login` accepts, so a crew member and an administrator at the
   * same school cannot have to remember different identifiers. The service
   * trims and resolves it.
   */
  @ValidateIf(onPinBranch)
  @IsString({ message: 'school_id must be a string' })
  @MaxLength(63, { message: 'school_id must be at most 63 characters' })
  @Matches(UUID_OR_SCHOOL_CODE, { message: 'school_id must be a valid UUID or school code' })
  school_id!: string;

  @ValidateIf(onPinBranch)
  @IsUUID('4', { message: 'user_id must be a valid UUID' })
  user_id!: string;

  /**
   * Exactly four ASCII digits. This is a *shape* check only: a PIN that looks
   * right and is wrong must be refused identically to a missing account, so
   * nothing downstream may treat passing this as evidence of authenticity.
   *
   * `@Matches(CREW_PIN_PATTERN)` is the load-bearing decorator here, not the
   * length pair — a length check alone accepts `'abcd'`, which is four
   * characters and not a PIN. The pattern is the shared one, so the server and
   * the mobile keypad enforce the identical rule; JS `\d` is ASCII-only without
   * the `u` flag, so Devanagari `१२३४` is correctly refused rather than being
   * quietly normalised into a different PIN.
   *
   * No trimming and no coercion, deliberately. `' 1234'` and the number `4821`
   * are both rejected rather than repaired: a client that lost the leading zero
   * of `0821` should fail loudly instead of attempting somebody else's PIN, and
   * an attempt that cannot succeed should not consume the account's
   * five-per-window allowance on a typo the server silently reinterpreted.
   */
  @ValidateIf(onPinBranch)
  @IsString({ message: 'pin must be a string' })
  @Matches(CREW_PIN_PATTERN, { message: 'pin must be exactly 4 digits' })
  @MinLength(CREW_PIN_LENGTH, { message: 'pin must be exactly 4 digits' })
  @MaxLength(CREW_PIN_LENGTH, { message: 'pin must be exactly 4 digits' })
  pin!: string;

  // ── QR branch ──────────────────────────────────────────────────────────────

  /**
   * An opaque, single-use QR pairing token issued by the web admin console
   * (`POST /drivers/:id/pairing-qr`), as scanned out of an
   * `SBT-CREW-1:<token>` payload. Never echoed back by any endpoint.
   *
   * The bound matches `crewLoginByQrSchema` exactly so a scan the mobile app
   * would have refused locally cannot be forced through by a hand-built request.
   */
  @ValidateIf(onQrBranch)
  @IsString({ message: 'pairing_token must be a string' })
  @MinLength(1, { message: 'pairing_token is required' })
  @MaxLength(CREW_PAIRING_TOKEN_MAX_LENGTH, { message: 'pairing_token is too long' })
  pairing_token!: string;
}

/**
 * Narrow the flat DTO onto the shared `CrewLoginRequest` union.
 *
 * This is the compile-time link between the two layers: the return type is
 * `crewPinLoginSchema`'s own inference, so if the shared contract gains, renames
 * or re-types a field this signature stops matching its caller until the route
 * catches up. It cannot drift silently the way a hand-copied object literal can.
 *
 * ### It parses the DTO's *own keys*, and that is the point
 *
 * The obvious implementation — rebuild `{ method: 'pin', school_id, user_id, pin }`
 * from the declared branch and parse that — is wrong, and was tried. Rebuilding
 * discards the very field this step exists to catch: a QR login carrying a `pin`
 * arrives at the schema as a clean two-field candidate that `.strict()` happily
 * accepts. Keeping the DTO's keys means the foreign branch's field is still
 * there when the strict schema looks, so it is rejected.
 *
 * ### But `undefined` keys have to be dropped first
 *
 * `plainToInstance` — which the global `ValidationPipe` uses — assigns *every*
 * declared property, because class-transformer's `exposeUnsetFields` defaults to
 * `true`. So a PIN body's instance carries `pairing_token: undefined` as a real
 * own key, and `.strict()` rejects it as unrecognised. Handing the instance to
 * the schema directly therefore fails every valid login.
 *
 * Filtering `undefined` restores the distinction that JSON already makes and
 * class-transformer erases: a key the client never sent disappears, while a key
 * the client *did* send survives — including one sent as `null`, which stays and
 * is correctly refused by the schema. This is verified empirically by
 * `crew-login.dto.spec.ts` rather than assumed.
 *
 * Returns `null` for anything the DTO structurally permits but the published
 * contract does not: the mixed-branch body above, a whitespace-only token the
 * schema trims to empty, a `null` where a string is required. The endpoint
 * answers `null` with a uniform 400 naming only the declared `method` — never a
 * submitted field, because on the PIN branch one of those fields is the PIN.
 */
export function narrowCrewLoginDto(body: CrewLoginDto): CrewLoginRequest | null {
  const sent = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  );
  const parsed = crewPinLoginSchema.safeParse(sent);
  return parsed.success ? parsed.data : null;
}
