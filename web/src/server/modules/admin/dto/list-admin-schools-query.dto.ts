import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AdminSchoolListQuery } from '@school-bus-tracking/shared-types';

/** Query string of `GET /api/v1/admin/schools`. */
export class ListAdminSchoolsQueryDto implements AdminSchoolListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must be at most 100' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(100, { message: 'search must be at most 100 characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'], { message: 'status must be either active or inactive' })
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsIn(['created_at', 'name', 'code'], { message: 'sort must be one of created_at, name, code' })
  sort?: 'created_at' | 'name' | 'code';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'order must be either asc or desc' })
  order?: 'asc' | 'desc';
}
