import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  MarketingCampaignStatus,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';
// Types referenced in decorated signatures must be imported as types when
// `isolatedModules` + `emitDecoratorMetadata` are on (the Next build).
import type {
  MarketingCampaignAudienceFilter,
  MarketingTemplateContentInput,
  MarketingTemplateVariable,
} from '@school-bus-tracking/shared-types';

/**
 * Strict DTOs for the Super Admin marketing endpoints.
 *
 * The global `ValidationPipe` (whitelist + forbidNonWhitelisted + transform)
 * bounds each payload's outer shape; deep validation — the audience filter,
 * the template content contract (placeholders, allowed variables) and the
 * schedule timestamp — runs in the services against the zod schemas from
 * `@school-bus-tracking/validation`, exactly like the admin-plans module
 * handles `features`/`limits`.
 *
 * Note what is deliberately **absent**: no endpoint accepts an email address.
 * Test sends resolve their recipients from `MARKETING_TEST_RECIPIENTS`
 * server-side, and campaign audiences are always computed from the schools
 * tables.
 */

// ---------------------------------------------------------------- templates

/** Body of `POST /api/v1/marketing/templates`. */
export class CreateMarketingTemplateDto {
  @IsString({ message: 'Please enter a valid template name.' })
  @MinLength(1, { message: 'Please enter the template name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  name!: string;

  @IsString({ message: 'Please enter a valid slug.' })
  @MinLength(2, { message: 'Please enter at least 2 characters for the slug.' })
  @MaxLength(80, { message: 'Please enter at most 80 characters for the slug.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  slug!: string;

  @IsObject({ message: 'Please provide the template content as an object.' })
  content!: MarketingTemplateContentInput;
}

/** Body of `PATCH /api/v1/marketing/templates/:id`. */
export class UpdateMarketingTemplateDto {
  @IsOptional()
  @IsString({ message: 'Please enter a valid template name.' })
  @MinLength(1, { message: 'Please enter the template name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  name?: string;
}

/** Body of `PUT /api/v1/marketing/templates/:id/content`. */
export class SaveMarketingTemplateContentDto {
  @IsString({ message: 'Please enter a subject line.' })
  @MinLength(1, { message: 'Please enter a subject line.' })
  @MaxLength(200, { message: 'Please enter at most 200 characters for the subject.' })
  subject!: string;

  @IsString({ message: 'Please provide the HTML body.' })
  @MinLength(1, { message: 'Please provide the HTML body.' })
  @MaxLength(100_000, { message: 'The HTML body must be at most 100,000 characters.' })
  html_body!: string;

  @IsString({ message: 'Please provide the plain-text body.' })
  @MinLength(1, { message: 'Please provide the plain-text body.' })
  @MaxLength(100_000, { message: 'The plain-text body must be at most 100,000 characters.' })
  text_body!: string;

  @IsOptional()
  @IsObject({ message: 'Please provide allowed_variables as an array of variable objects.' })
  allowed_variables?: MarketingTemplateVariable[];
}

/** Body of the preview and test-send endpoints (no recipient field, ever). */
export class MarketingTemplateRenderDto {
  @IsOptional()
  @IsString({ message: 'Please provide a valid version id.' })
  @MaxLength(64, { message: 'Please provide a valid version id.' })
  version_id?: string | null;

  @IsOptional()
  @IsObject({ message: 'Please provide sample variables as an object.' })
  variables?: Record<string, string> | null;
}

/** Query string of `GET /api/v1/marketing/templates`. */
export class ListMarketingTemplatesQueryDto {
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
  @IsString({ message: 'Please enter valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'], {
    message: 'Please select a valid template status (DRAFT, PUBLISHED, ARCHIVED).',
  })
  status?: MarketingTemplateStatus;

  @IsOptional()
  @IsIn(['created_at', 'name', 'slug'], {
    message: 'Please select a valid sort field (created_at, name, slug).',
  })
  sort?: 'created_at' | 'name' | 'slug';

  @IsOptional()
  @IsIn(['asc', 'desc'], {
    message: 'Please select a valid sort direction (asc, desc).',
  })
  order?: 'asc' | 'desc';
}

// ---------------------------------------------------------------- campaigns

/** Body of `POST /api/v1/marketing/campaigns`. */
export class CreateMarketingCampaignDto {
  @IsString({ message: 'Please enter a valid campaign name.' })
  @MinLength(1, { message: 'Please enter the campaign name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  name!: string;

  @IsString({ message: 'Please provide a template version id.' })
  @MaxLength(64, { message: 'Please provide a valid template version id.' })
  template_version_id!: string;

  @IsObject({ message: 'Please provide the audience filter as an object.' })
  audience_filter!: MarketingCampaignAudienceFilter;
}

/** Body of `PATCH /api/v1/marketing/campaigns/:id`. */
export class UpdateMarketingCampaignDto {
  @IsOptional()
  @IsString({ message: 'Please enter a valid campaign name.' })
  @MinLength(1, { message: 'Please enter the campaign name.' })
  @MaxLength(150, { message: 'Please enter at most 150 characters for the name.' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Please provide a template version id.' })
  @MaxLength(64, { message: 'Please provide a valid template version id.' })
  template_version_id?: string;

  @IsOptional()
  @IsObject({ message: 'Please provide the audience filter as an object.' })
  audience_filter?: MarketingCampaignAudienceFilter;
}

/** Body of `POST /api/v1/marketing/campaigns/:id/schedule`. */
export class ScheduleMarketingCampaignDto {
  @IsOptional()
  @IsString({ message: 'Please provide scheduled_at as an ISO 8601 date-time.' })
  @MaxLength(40, { message: 'Please provide scheduled_at as an ISO 8601 date-time.' })
  scheduled_at?: string | null;
}

/** Body of `POST /api/v1/marketing/campaigns/audience-preview`. */
export class MarketingAudiencePreviewDto {
  @IsOptional()
  @IsString({ message: 'Please provide a valid campaign id.' })
  @MaxLength(64, { message: 'Please provide a valid campaign id.' })
  campaign_id?: string | null;

  @IsOptional()
  @IsObject({ message: 'Please provide the audience filter as an object.' })
  audience_filter?: MarketingCampaignAudienceFilter | null;
}

/** Query string of `GET /api/v1/marketing/campaigns`. */
export class ListMarketingCampaignsQueryDto {
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
  @IsString({ message: 'Please enter valid search text.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the search text.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'], {
    message: 'Please select a valid campaign status.',
  })
  status?: MarketingCampaignStatus;
}
