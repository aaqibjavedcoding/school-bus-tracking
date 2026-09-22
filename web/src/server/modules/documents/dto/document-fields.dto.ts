import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
  isISO8601,
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
 * `class-validator` has no DATEONLY validator and `isISO8601` alone would also
 * accept a bare year or a week date, so the shared document date rule pairs a
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

/**
 * One rule, one message: a document date is either a real calendar date in
 * `YYYY-MM-DD` form (a full ISO-8601 date-time is accepted too) or the field is
 * wrong. Presence is reported separately by `@IsNotEmpty`, so a missing date
 * produces exactly one line of guidance naming that field instead of a stack of
 * shape complaints.
 */
export function IsDocumentDate(label: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    registerDecorator({
      name: 'documentDate',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown): boolean {
          // Absent values are the presence rule's business.
          if (value === null || value === undefined) {
            return true;
          }
          return (
            typeof value === 'string' &&
            DOCUMENT_DATE_PATTERN.test(value) &&
            isISO8601(value, { strict: true })
          );
        },
        defaultMessage(): string {
          return `Please enter the ${label} as a real date (for example 2026-04-01).`;
        },
      },
    });
  };
}

/**
 * The document number must be present, non-blank text within the shared length
 * bound. One message per failure, naming the field — and the length case says
 * what the limit is.
 */
export function IsDocumentNumber(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    registerDecorator({
      name: 'documentNumber',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            value.trim().length > 0 &&
            value.length <= DOCUMENT_NUMBER_MAX_LENGTH
          );
        },
        defaultMessage(args: ValidationArguments): string {
          const value = args.value as unknown;
          if (typeof value === 'string' && value.length > DOCUMENT_NUMBER_MAX_LENGTH) {
            return `Please enter at most ${DOCUMENT_NUMBER_MAX_LENGTH} characters for the document number.`;
          }
          return 'Please enter the document number.';
        },
      },
    });
  };
}

/**
 * The two compliance dates must form a real validity window: an expiry on or
 * before the issue date is a typo, not a document. Reported on `expiry_date`,
 * which is the field the user has to correct.
 *
 * A missing or unparsable pair is left to the presence and format rules of the
 * individual fields, so a create payload with nothing but a document type
 * still gets one clear message per missing field.
 */
export function ExpiryAfterIssue(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    registerDecorator({
      name: 'expiryAfterIssue',
      target: target.constructor,
      propertyName: String(propertyKey),
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const issue = (args.object as { issue_date?: string | null }).issue_date;
          if (typeof value !== 'string' || typeof issue !== 'string') {
            return true;
          }
          const expiry = Date.parse(value);
          const issued = Date.parse(issue);
          if (Number.isNaN(expiry) || Number.isNaN(issued)) {
            return true;
          }
          return expiry > issued;
        },
        defaultMessage(): string {
          return 'Please enter an expiry date after the issue date.';
        },
      },
    });
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
      { message: 'Please enter a valid web link (http or https) for the file.' },
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
        defaultMessage(): string {
          return 'Please use an https link for the file link.';
        },
      },
    });
  };
}

/**
 * The optional paperwork fields every document payload carries: where the scan
 * lives and any notes the school wants next to it. `null` clears them on
 * update; nothing here is part of the compliance rule itself.
 */
export abstract class DocumentFileFieldsDto {
  @IsOptional()
  @IsString({ message: 'Please enter valid notes.' })
  @MaxLength(DOCUMENT_NOTES_MAX_LENGTH, {
    message: `Please enter at most ${DOCUMENT_NOTES_MAX_LENGTH} characters for the notes.`,
  })
  @Transform(nullableTrim)
  declare notes?: string | null;

  @IsOptional()
  @IsString({ message: 'Please enter a valid file name.' })
  @MaxLength(DOCUMENT_FILE_NAME_MAX_LENGTH, {
    message: `Please enter at most ${DOCUMENT_FILE_NAME_MAX_LENGTH} characters for the file name.`,
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
  @IsString({ message: 'Please enter a valid file link.' })
  @IsFileUrl()
  @MaxLength(DOCUMENT_FILE_URL_MAX_LENGTH, {
    message: `Please enter at most ${DOCUMENT_FILE_URL_MAX_LENGTH} characters for the file link.`,
  })
  @Transform(nullableTrim)
  declare file_url?: string | null;
}

/**
 * The compliance fields of an **update** (`PATCH`) payload.
 *
 * Every field is optional so a partial update stays partial, but the three
 * fields a compliance record is made of — the number on the paper and the two
 * dates — can only be *corrected*, never removed: an explicit `null` is
 * refused with the same wording the create payload uses. Notes and file
 * references still clear with `null` (see {@link DocumentFileFieldsDto}).
 *
 * `school_id`, `bus_id` and `driver_id` are absent on purpose — they come from
 * the verified JWT and the route, and a client-supplied value is rejected by
 * the global whitelist pipe.
 */
export abstract class DocumentFieldsDto extends DocumentFileFieldsDto {
  // `value !== undefined` (rather than `@IsOptional`) keeps an absent field
  // untouched while still refusing an explicit `null`.
  @ValidateIf((_object, value) => value !== undefined)
  @IsDocumentNumber()
  @Transform(nullableTrim)
  declare document_number?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNotEmpty({ message: 'Please enter the issue date.' })
  @IsDocumentDate('issue date')
  @Transform(nullableTrim)
  declare issue_date?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNotEmpty({ message: 'Please enter the expiry date.' })
  @IsDocumentDate('expiry date')
  @ExpiryAfterIssue()
  @Transform(nullableTrim)
  declare expiry_date?: string | null;
}

/**
 * The compliance fields of a **create** (`POST`) payload.
 *
 * A document without its number and both dates is not a compliance record — it
 * can never be verified, and it silently counts as valid because there is no
 * expiry to compare against — so all three are mandatory here. The cross-field
 * rule ({@link ExpiryAfterIssue}) is applied at validation time so the client
 * gets the same message whether it posts or patches.
 *
 * There is deliberately **no** `status` field: validity is derived from
 * `expiry_date` and can never be asserted by a client.
 */
export abstract class DocumentCreateFieldsDto extends DocumentFileFieldsDto {
  @IsDocumentNumber()
  @Transform(nullableTrim)
  document_number!: string;

  @IsNotEmpty({ message: 'Please enter the issue date.' })
  @IsDocumentDate('issue date')
  @Transform(nullableTrim)
  issue_date!: string;

  @IsNotEmpty({ message: 'Please enter the expiry date.' })
  @IsDocumentDate('expiry date')
  @ExpiryAfterIssue()
  @Transform(nullableTrim)
  expiry_date!: string;
}
