import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EMERGENCY_MESSAGE_MAX_LENGTH } from '@school-bus-tracking/validation';

const nullableTrim = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Body of `PATCH /api/v1/emergencies/:id/cancel` (the crew member who raised
 * the alarm).
 *
 * The body is **note-only**: the target status is fixed to `CANCELLED` by the
 * route, so a crew member can retract a false alarm but can never resolve or
 * acknowledge an incident on behalf of the school. Sending a `status` is
 * rejected by the global whitelist pipe rather than silently ignored.
 */
export class CancelEmergencyDto {
  /** Why the alarm was raised by mistake. */
  @IsOptional()
  @IsString({ message: 'note must be a string' })
  @MaxLength(EMERGENCY_MESSAGE_MAX_LENGTH, {
    message: `note must be at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare note?: string | null;
}
