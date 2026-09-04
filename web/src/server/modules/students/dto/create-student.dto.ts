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
  @IsString({ message: 'admission_number must be a string' })
  @IsNotEmpty({ message: 'admission_number is required' })
  @MaxLength(64, { message: 'admission_number must be at most 64 characters' })
  @Transform(trimValue)
  admission_number!: string;

  @IsString({ message: 'first_name must be a string' })
  @IsNotEmpty({ message: 'first_name is required' })
  @MaxLength(100, { message: 'first_name must be at most 100 characters' })
  @Transform(trimValue)
  first_name!: string;

  @IsString({ message: 'last_name must be a string' })
  @IsNotEmpty({ message: 'last_name is required' })
  @MaxLength(100, { message: 'last_name must be at most 100 characters' })
  @Transform(trimValue)
  last_name!: string;

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
