import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ParentStudentRelationshipUpdateRequest } from '@school-bus-tracking/shared-types';

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

/** Body of relationship PATCH endpoints. */
export class UpdateParentStudentRelationshipDto implements ParentStudentRelationshipUpdateRequest {
  @IsOptional()
  @IsString({ message: 'relationship must be a string' })
  @IsNotEmpty({ message: 'relationship cannot be empty' })
  @MaxLength(50, { message: 'relationship must be at most 50 characters' })
  @Transform(trimValue)
  declare relationship?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'can_pick_up must be a boolean' })
  declare can_pick_up?: boolean;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_primary must be a boolean' })
  declare is_primary?: boolean;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'is_active must be a boolean' })
  declare is_active?: boolean;
}
