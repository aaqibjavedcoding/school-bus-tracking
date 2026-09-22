import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { EmergencyStatus, EmergencyStatusUpdateRequest } from '@school-bus-tracking/shared-types';
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
 * Body of `PATCH /api/v1/emergencies/:id/status`.
 *
 * Only the *target* status is accepted; the transition rules live in the
 * shared `EMERGENCY_STATUS_TRANSITIONS` map and are enforced by the service,
 * so a closed incident can never be reopened by a client.
 */
export class UpdateEmergencyStatusDto implements EmergencyStatusUpdateRequest {
  @IsEnum(EmergencyStatus, {
    message: `Please select a valid status (one of: ${Object.values(EmergencyStatus).join(', ')}).`,
  })
  status!: EmergencyStatus;

  /** Free-text audit note ("school van dispatched, all students safe"). */
  @IsOptional()
  @IsString({ message: 'Please enter a valid note.' })
  @MaxLength(EMERGENCY_MESSAGE_MAX_LENGTH, {
    message: `Please enter at most ${EMERGENCY_MESSAGE_MAX_LENGTH} characters for the note.`,
  })
  @Transform(nullableTrim)
  declare note?: string | null;
}
