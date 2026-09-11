import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';
import {
  DOCUMENT_FILE_NAME_MAX_LENGTH,
  DOCUMENT_FILE_URL_MAX_LENGTH,
  DOCUMENT_NOTES_MAX_LENGTH,
  DOCUMENT_NUMBER_MAX_LENGTH,
} from '@school-bus-tracking/validation';

/**
 * `class-validator` has no DATEONLY validator and `IsDateString` alone would
 * also accept a bare year or a week date, so the shared document DTOs pair a
 * strict shape check with the ISO-8601 check. A calendar date
 * (`2026-03-31`) and a full date-time (`2026-03-31T00:00:00.000Z`) are both
 * accepted; `2026-02-31` is not.
 */
const DOCUMENT_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Trims and maps an empty string to `null` (explicit `null` clears a field). */
export const nullableTrim = ({ value }: { value: unknown }): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Applies the shared document date rule to one property. */
function IsDocumentDate(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    Matches(DOCUMENT_DATE_PATTERN, {
      message: `${String(propertyKey)} must be in YYYY-MM-DD format`,
    })(target, propertyKey);
    IsDateString(
      { strict: true },
      { message: `${String(propertyKey)} must be a valid calendar date` },
    )(target, propertyKey);
  };
}

/**
 * Production hardening for externally supplied document links: `http://` is
 * rejected in production (a plaintext link can leak session context through
 * intermediaries and be silently downgraded), while `https://` keeps working
 * and local development still accepts `http://` so internal file stores and
 * object-storage sandboxes without TLS keep working.
 */
export function IsFileUrl(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    IsUrl(
      { protocols: ['http', 'https'], require_protocol: true },
      { message: 'file_url must be a valid http(s) URL' },
    )(target, propertyKey);
    registerDecorator({
      name: 'fileUrlHttpsOnlyInProduction',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown): boolean {
          // `IsOptional` / `IsUrl` own the empty, non-string and shape cases.
          if (typeof value !== 'string' || value.length === 0) {
            return true;
          }
          if (process.env.NODE_ENV !== 'production') {
            return true;
          }
          try {
            return new URL(value).protocol === 'https:';
          } catch {
            // Malformed URLs are reported by `IsUrl`.
            return true;
          }
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must use https in production`;
        },
      },
    });
  };
}

/**
 * Field set shared by every bus/driver document request.
 *
 * Every field is optional and `null` clears it, so the same shape serves both
 * create (all fields may be omitted) and update (only the supplied fields
 * change). There is deliberately **no** `status` field: validity is derived
 * from `expiry_date` and can never be asserted by a client.
 *
 * `school_id`, `bus_id` and `driver_id` are absent on purpose — they come from
 * the verified JWT and the route, and a client-supplied value is rejected by
 * the global whitelist pipe.
 */
export abstract class DocumentFieldsDto {
  @IsOptional()
  @IsString({ message: 'document_number must be a string' })
  @MaxLength(DOCUMENT_NUMBER_MAX_LENGTH, {
    message: `document_number must be at most ${DOCUMENT_NUMBER_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare document_number?: string | null;

  @IsOptional()
  @IsDocumentDate()
  @Transform(nullableTrim)
  declare issue_date?: string | null;

  @IsOptional()
  @IsDocumentDate()
  @Transform(nullableTrim)
  declare expiry_date?: string | null;

  @IsOptional()
  @IsString({ message: 'notes must be a string' })
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH, {
    message: `notes must be at most ${DOCUMENT_NOTES_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare notes?: string | null;

  @IsOptional()
  @IsString({ message: 'file_name must be a string' })
  @MaxLength(DOCUMENT_FILE_NAME_MAX_LENGTH, {
    message: `file_name must be at most ${DOCUMENT_FILE_NAME_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare file_name?: string | null;

  /**
   * Reference to the document file in the school's own store. Only http(s)
   * URLs are accepted: the platform never stores binary uploads, and a
   * `javascript:` / `data:` style value must never be rendered as a link.
   * In production only `https://` is accepted (`IsFileUrl`).
   */
  @IsOptional()
  @IsString({ message: 'file_url must be a string' })
  @IsFileUrl()
  @MaxLength(DOCUMENT_FILE_URL_MAX_LENGTH, {
    message: `file_url must be at most ${DOCUMENT_FILE_URL_MAX_LENGTH} characters`,
  })
  @Transform(nullableTrim)
  declare file_url?: string | null;
}
