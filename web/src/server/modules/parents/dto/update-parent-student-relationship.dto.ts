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
  @IsString({ message: 'Please enter a valid relationship.' })
  @IsNotEmpty({ message: 'Please enter a value for the relationship.' })
  @MaxLength(50, { message: 'Please enter at most 50 characters for the relationship.' })
  @Transform(trimValue)
  declare relationship?: string;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the pick-up permission.' })
  declare can_pick_up?: boolean;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the primary contact flag.' })
  declare is_primary?: boolean;

  @IsOptional()
  @Transform(booleanValue)
  @IsBoolean({ message: 'Please choose true or false for the active status.' })
  declare is_active?: boolean;
}
