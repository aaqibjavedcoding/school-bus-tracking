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
import { StudentGender, StudentUpdateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Body of `PATCH /api/v1/students/:id`.
 *
 * Every field is optional (partial update). There is no `school_id` field at
 * all — ownership can never be changed through the API, and a client supplied
 * `school_id` is rejected by the global ValidationPipe.
 */
export class UpdateStudentDto implements StudentUpdateRequest {
  @IsOptional()
  @IsString({ message: 'admission_number must be a string' })
  @IsNotEmpty({ message: 'admission_number cannot be empty' })
  @MaxLength(64, { message: 'admission_number must be at most 64 characters' })
  @Transform(trimValue)
  declare admission_number?: string;

  @IsOptional()
  @IsString({ message: 'first_name must be a string' })
  @IsNotEmpty({ message: 'first_name cannot be empty' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  @Transform(trimValue)
  declare first_name?: string;

  @IsOptional()
  @IsString({ message: 'last_name must be a string' })
  @IsNotEmpty({ message: 'last_name cannot be empty' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  @Transform(trimValue)
  declare last_name?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date_of_birth must be a valid date in YYYY-MM-DD format',
  })
  @Transform(trimValue)
  declare date_of_birth?: string | null;

  @IsOptional()
  @IsEnum(StudentGender, { message: 'gender must be MALE, FEMALE or OTHER' })
  declare gender?: StudentGender | null;

  @IsOptional()
  @IsString({ message: 'grade_level must be a string' })
  @MaxLength(32, { message: 'grade_level must be at most 32 characters' })
  @Transform(trimValue)
  declare grade_level?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'home_stop_id must be a valid UUID' })
  declare home_stop_id?: string | null;

  @IsOptional()
  @IsString({ message: 'emergency_contact_name must be a string' })
  @MaxLength(150, {
    message: 'emergency_contact_name must be at most 150 characters',
  })
  @Transform(trimValue)
  declare emergency_contact_name?: string | null;

  @IsOptional()
  @IsString({ message: 'emergency_contact_phone must be a string' })
  @MaxLength(32, { message: 'emergency_contact_phone must be at most 32 characters' })
  @Transform(trimValue)
  declare emergency_contact_phone?: string | null;

  @IsOptional()
  @IsString({ message: 'medical_notes must be a string' })
  @MaxLength(4000, { message: 'medical_notes must be at most 4000 characters' })
  @Transform(trimValue)
  declare medical_notes?: string | null;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
