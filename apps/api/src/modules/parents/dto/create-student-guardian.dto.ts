import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { StudentGuardianCreateRequest } from '@school-bus-tracking/shared-types';

const trimValue = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const booleanValue = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/** Body of `POST /api/v1/students/:studentId/guardians`. */
export class CreateStudentGuardianDto implements StudentGuardianCreateRequest {
  @IsUUID(undefined, { message: 'parent_id must be a valid UUID' })
  parent_id!: string;

  @IsString({ message: 'relationship must be a string' })
  @IsNotEmpty({ message: 'relationship is required' })
  @MaxLength(50, { message: 'relationship must be at most 50 characters' })
  @Transform(trimValue)
  relationship!: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'can_pick_up must be a boolean' })
  declare can_pick_up?: boolean;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_primary must be a boolean' })
  declare is_primary?: boolean;
}
