import { IsISO8601, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { TripCreateRequest } from '@school-bus-tracking/shared-types';

/**
 * Body of `POST /api/v1/trips`.
 *
 * The payload names a dispatch **source** and a schedule; every resource is
 * derived server-side, so a request can neither cross tenants nor forge a trip
 * state:
 *
 * - `run_id` (preferred): route, bus, driver and conductor come from the run
 *   and its `run_crew` roster (`docs/operating-model.md` §8.4).
 * - `route_assignment_id` (**deprecated**): the pre-refactor path, kept so
 *   existing callers keep working. Exactly one of the two is required — the
 *   service rejects both-present and both-absent payloads with 400.
 */
export class CreateTripDto implements TripCreateRequest {
  @IsOptional()
  @IsUUID(undefined, { message: 'run_id must be a valid UUID' })
  declare run_id?: string;

  @ValidateIf((dto: CreateTripDto) => dto.run_id === undefined)
  @IsUUID(undefined, { message: 'route_assignment_id must be a valid UUID' })
  declare route_assignment_id?: string;

  @IsISO8601({ strict: true }, { message: 'scheduled_start_at must be a valid ISO-8601 date-time' })
  scheduled_start_at!: string;

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'scheduled_end_at must be a valid ISO-8601 date-time' })
  declare scheduled_end_at?: string | null;
}
