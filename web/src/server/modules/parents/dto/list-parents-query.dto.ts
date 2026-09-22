import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ParentListQuery } from '@school-bus-tracking/shared-types';

/** Query string of `GET /api/v1/parents`. */
export class ListParentsQueryDto implements ParentListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page number.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page number.' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a whole number for the page size.' })
  @Min(1, { message: 'Please enter a value of at least 1 for the page size.' })
  @Max(100, { message: 'Please enter a value of at most 100 for the page size.' })
  limit: number = 20;

  @IsOptional()
  @IsString({ message: 'Please enter a valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}
