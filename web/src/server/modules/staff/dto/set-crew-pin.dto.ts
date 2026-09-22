import { IsString, Matches, ValidateIf } from 'class-validator';
import type { CrewPinSetRequest } from '@school-bus-tracking/shared-types';
import { CREW_PIN_LENGTH, CREW_PIN_PATTERN } from '@school-bus-tracking/validation';

/**
 * Body of `PUT /api/v1/drivers/:driverId/pin` and
 * `PUT /api/v1/conductors/:id/pin` (Mobile-UX Phase 4).
 *
 * Implements the shared `CrewPinSetRequest`, so the admin console and the API
 * cannot drift: the console validates with `crewPinSetSchema` before it sends,
 * and this DTO is the same rule expressed for the repository's standard
 * `ValidationPipe` (whitelist + forbidNonWhitelisted, so an unknown field is a
 * 400 that names it).
 *
 * ### `pin: null` clears
 *
 * There is no separate "delete PIN" endpoint. `null` clears it, which drops the
 * crew member back to QR pairing until an administrator sets a new one, and a
 * *reset* is simply setting a different value. Both are the same write, the same
 * audit action and the same lockout lift, so there is one code path to reason
 * about rather than three.
 *
 * ### No composition rules beyond the length
 *
 * `CREW_PIN_LENGTH` digits is the whole policy, and it is the *same* policy the
 * login side checks. That matters: a strength rule applied only when a PIN is
 * created would let a policy change lock out every crew member whose PIN was set
 * under the old rule — the exact mistake `LoginDto` documents avoiding for
 * passwords.
 *
 * The plaintext PIN arrives here, is hashed once by `CrewAuthService.setPin()`,
 * and is never returned, logged or audited.
 */
export class SetCrewPinDto implements CrewPinSetRequest {
  /**
   * `@ValidateIf` runs the format check for anything that is *not* `null`, so
   * `null` (clear) is accepted, `undefined` (absent) is rejected by `@IsString`,
   * and a wrong-length PIN is rejected by `@Matches`. Without the guard, an
   * omitted `pin` would sail through as `undefined` and reach the hasher.
   *
   * `pin` carries validation metadata either way, which is what keeps
   * `whitelist: true` from stripping a legitimate `null` — verified by
   * `set-crew-pin.dto.spec.ts`, because a silently stripped `null` would turn
   * "clear this PIN" into "hash the string undefined".
   */
  @ValidateIf((_object: SetCrewPinDto, value: unknown) => value !== null)
  @IsString({ message: 'Please enter a valid PIN, or leave it empty to clear it.' })
  @Matches(CREW_PIN_PATTERN, {
    message: `Please enter the PIN as exactly ${CREW_PIN_LENGTH} digits.`,
  })
  declare pin: string | null;
}
