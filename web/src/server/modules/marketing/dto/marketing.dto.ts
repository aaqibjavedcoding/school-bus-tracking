import {
  IsBoolean,
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
  MarketingLeadSource,
  MarketingLeadStatus,
  MarketingTemplateStatus,
} from '@school-bus-tracking/shared-types';
// Types referenced in decorated signatures must be imported as types when
// `isolatedModules` + `emitDecoratorMetadata` are on (the Next build).
import type {
  MarketingCampaignAudienceFilter,
  MarketingTemplateContentInput,
  MarketingTemplateVariable,
  MarketingUtmParameters,
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

// -------------------------------------------------------------------- leads

/**
 * Body of the **public** `POST /api/v1/public/marketing/demo-request`.
 *
 * Bounds the outer shape only; the deep validation (email format, consent
 * literal, ISO country, phone pattern) is the shared
 * `marketingDemoLeadInputSchema` run inside the service — one source of
 * field truth for the browser form, the API and the docs.
 *
 * Note what is deliberately **absent**: no `school_id`, no `campaign_id`,
 * no `recipient_id`, no notification address. Attribution comes exclusively
 * from the opaque server-set cookie; `forbidNonWhitelisted` rejects any
 * attempt to smuggle an id in.
 */
export class PublicDemoRequestDto {
  @IsString({ message: 'Please enter your full name.' })
  @MinLength(2, { message: 'Please enter at least 2 characters for your name.' })
  @MaxLength(120, { message: 'Please enter at most 120 characters for your name.' })
  full_name!: string;

  @IsString({ message: 'Please enter your work email address.' })
  @MinLength(3, { message: 'Please enter a valid work email address.' })
  @MaxLength(254, { message: 'Please enter at most 254 characters for the email address.' })
  email!: string;

  @IsString({ message: 'Please enter your school or institution name.' })
  @MinLength(2, { message: 'Please enter at least 2 characters for the institution name.' })
  @MaxLength(200, { message: 'Please enter at most 200 characters for the institution name.' })
  institution_name!: string;

  @IsOptional()
  @IsString({ message: 'Please enter a valid phone number.' })
  @MaxLength(32, { message: 'Please enter at most 32 characters for the phone number.' })
  phone?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid city.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the city.' })
  city?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid country code.' })
  @MaxLength(2, { message: 'Country must be a 2-letter ISO code.' })
  country?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid message.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the message.' })
  message?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid preferred contact time.' })
  @MaxLength(100, { message: 'Please enter at most 100 characters for the contact time.' })
  preferred_contact_time?: string | null;

  @IsOptional()
  @IsObject({ message: 'Please provide UTM attribution as an object.' })
  utm?: MarketingUtmParameters | null;

  @IsBoolean({ message: 'Please confirm you agree to be contacted about your demo request.' })
  consent!: boolean;

  /** Honeypot — humans never see it; a filled value marks a bot. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string | null;
}

/** Query string of `GET /api/v1/marketing/leads`. */
export class ListMarketingLeadsQueryDto {
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
  @IsIn(['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'CONVERTED', 'LOST'], {
    message: 'Please select a valid lead status.',
  })
  status?: MarketingLeadStatus;

  @IsOptional()
  @IsIn(['LANDING_PAGE', 'CAMPAIGN_REPLY', 'MANUAL'], {
    message: 'Please select a valid lead source.',
  })
  source?: MarketingLeadSource;

  @IsOptional()
  @IsString({ message: 'Please provide a valid campaign id.' })
  @MaxLength(64, { message: 'Please provide a valid campaign id.' })
  campaign_id?: string;

  @IsOptional()
  @IsString({ message: 'Please provide the start date as an ISO date.' })
  @MaxLength(40, { message: 'Please provide the start date as an ISO date.' })
  created_from?: string;

  @IsOptional()
  @IsString({ message: 'Please provide the end date as an ISO date.' })
  @MaxLength(40, { message: 'Please provide the end date as an ISO date.' })
  created_to?: string;
}

/** Body of `PATCH /api/v1/marketing/leads/:id/status`. */
export class UpdateMarketingLeadStatusDto {
  @IsIn(['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED', 'CONVERTED', 'LOST'], {
    message: 'Please select a valid lead status.',
  })
  status!: MarketingLeadStatus;

  @IsOptional()
  @IsString({ message: 'Please enter a valid note.' })
  @MinLength(1, { message: 'Please enter the note text.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the note.' })
  note?: string;
}

/** Body of `POST /api/v1/marketing/leads/:id/notes`. */
export class AddMarketingLeadNoteDto {
  @IsString({ message: 'Please enter the note text.' })
  @MinLength(1, { message: 'Please enter the note text.' })
  @MaxLength(2000, { message: 'Please enter at most 2000 characters for the note.' })
  note!: string;
}
