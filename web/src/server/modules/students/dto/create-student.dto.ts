import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { StudentCreateRequest, StudentGender } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `POST /api/v1/students`.
 *
 * Implements the shared `StudentCreateRequest` contract. There is intentionally
 * no `school_id` field: the tenant comes exclusively from the authenticated
 * user's JWT claims, and the global `ValidationPipe` (whitelist +
 * forbidNonWhitelisted) rejects any client-supplied `school_id` with 400.
 */
export class CreateStudentDto implements StudentCreateRequest {
  @IsString({ message: 'Please enter a valid admission number.' })
  @IsNotEmpty({ message: 'Please enter a value for the admission number.' })
  @MaxLength(64, { message: 'Please enter at most 64 characters for the admission number.' })
  @Transform(trimValue)
  admission_number!: string;

  @IsString({ message: 'Please enter a valid first name.' })
  @IsNotEmpty({ message: 'Please enter the first name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the first name.' })
  @Transform(trimValue)
  first_name!: string;

  @IsString({ message: 'Please enter a valid last name.' })
  @IsNotEmpty({ message: 'Please enter the last name.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the last name.' })
  @Transform(trimValue)
  last_name!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please enter the date of birth as YYYY-MM-DD.',
  })
  @Transform(trimValue)
  declare date_of_birth?: string | null;

  @IsOptional()
  @IsEnum(StudentGender, { message: 'Please select a valid gender (one of: MALE, FEMALE, OTHER).' })
  declare gender?: StudentGender | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid grade level.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the grade level.' })
  @Transform(trimValue)
  declare grade_level?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid home stop.' })
  declare home_stop_id?: string | null;

  /** Run (vehicle) the pupil rides; validated tenant- and stop-wise by the service. */
  @IsOptional()
  @IsUUID(undefined, { message: 'Please select a valid run.' })
  declare run_id?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid emergency contact name.' })
  @MaxLength(150, {
    message: 'Please enter at most 150 characters for the emergency contact name.',
  })
  @Transform(trimValue)
  declare emergency_contact_name?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid emergency contact phone number.' })
  @MaxLength(32, {
    message: 'Please enter at most 32 characters for the emergency contact phone number.',
  })
  @Transform(trimValue)
  declare emergency_contact_phone?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter valid medical notes.' })
  @MaxLength(4000, { message: 'Please enter at most 4000 characters for the medical notes.' })
  @Transform(trimValue)
  declare medical_notes?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
