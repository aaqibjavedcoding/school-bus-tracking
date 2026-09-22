/**
 * Reimplementation of `@nestjs/common`'s `ParseUUIDPipe`.
 *
 * The error contract is what matters here: a malformed route parameter is a
 * `400` with a message a non-technical user can act on — it names the resource
 * the parameter stands for ("Please select a valid school."), never the
 * internal wire format. The codebase uses two option shapes —
 * `{ errorHttpStatusCode: HttpStatus.BAD_REQUEST }` (the default status
 * anyway) and `{ version: '4' }` — both of which are honoured, and `label`
 * names the resource for the message.
 */
import { BadRequestException, HttpException, HttpStatus } from './http-exception';

export type UUIDVersion = '3' | '4' | '5' | '7' | 'all';

export interface ParseUUIDPipeOptions {
  version?: UUIDVersion;
  errorHttpStatusCode?: number;
  exceptionFactory?: (error: string) => unknown;
  /**
   * The resource the parameter identifies, used in the refusal message — e.g.
   * `'school'` produces "Please select a valid school." When it is omitted the
   * generic id wording is used.
   */
  label?: string;
}

/** Per-version UUID patterns, matching the `uuid` validator in class-validator. */
const UUID_PATTERNS: Record<UUIDVersion, RegExp> = {
  3: /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  5: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  all: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

/**
 * Plain-language refusal for a route parameter that is not a UUID.
 *
 * `label` names the thing the caller was trying to reach, so the message reads
 * as guidance ("Please select a valid route.") instead of describing the
 * parser that rejected the value. Without a label the generic wording is used.
 */
export function uuidParamMessage(label?: string): string {
  return label ? `Please select a valid ${label}.` : 'Please select a valid id.';
}

/** Refusal message when a UUID parameter carries no resource label. */
export const UUID_PARAM_MESSAGE = uuidParamMessage();

/** Backwards-compatible alias of {@link UUID_PARAM_MESSAGE}. */
export const UUID_VALIDATION_FAILED_MESSAGE = UUID_PARAM_MESSAGE;

export function isUuid(value: unknown, version: UUIDVersion = 'all'): value is string {
  return typeof value === 'string' && UUID_PATTERNS[version].test(value);
}

export class ParseUUIDPipe {
  private readonly version: UUIDVersion;
  private readonly errorHttpStatusCode: number;
  private readonly exceptionFactory: (error: string) => unknown;
  private readonly message: string;

  constructor(options: ParseUUIDPipeOptions = {}) {
    this.version = options.version ?? 'all';
    this.errorHttpStatusCode = options.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST;
    this.message = uuidParamMessage(options.label);
    this.exceptionFactory =
      options.exceptionFactory ??
      ((error: string) =>
        this.errorHttpStatusCode === HttpStatus.BAD_REQUEST
          ? new BadRequestException(error)
          : new HttpException(error, this.errorHttpStatusCode));
  }

  async transform(value: unknown): Promise<string> {
    if (!isUuid(value, this.version)) {
      throw this.exceptionFactory(this.message);
    }
    return value as string;
  }
}

/** Options accepted by {@link parseUuidParam}. */
export interface ParseUuidParamOptions {
  version?: UUIDVersion;
  /** Resource name used in the refusal message, e.g. `'bus'`. */
  label?: string;
}

/**
 * Convenience helper for route handlers: validate a path param or throw 400.
 *
 * The second argument accepts either the historical bare version
 * (`parseUuidParam(value, '4')`) or an options object carrying both the
 * version and the resource label (`parseUuidParam(value, { label: 'bus' })`).
 */
export function parseUuidParam(
  value: unknown,
  options: UUIDVersion | ParseUuidParamOptions = {},
): string {
  const version: UUIDVersion = typeof options === 'string' ? options : (options.version ?? 'all');
  const label = typeof options === 'string' ? undefined : options.label;
  if (!isUuid(value, version)) {
    throw new BadRequestException(uuidParamMessage(label));
  }
  return value as string;
}
