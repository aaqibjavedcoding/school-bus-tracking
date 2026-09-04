/**
 * Reimplementation of `@nestjs/common`'s `ParseUUIDPipe`.
 *
 * The error contract is what matters here and is preserved exactly: an
 * invalid UUID produces a `BadRequestException` whose message is the literal
 * string `Validation failed (uuid is expected)`. The codebase uses two option
 * shapes — `{ errorHttpStatusCode: HttpStatus.BAD_REQUEST }` (the default
 * status anyway) and `{ version: '4' }` — both of which are honoured.
 */
import { BadRequestException, HttpException, HttpStatus } from './http-exception';

export type UUIDVersion = '3' | '4' | '5' | '7' | 'all';

export interface ParseUUIDPipeOptions {
  version?: UUIDVersion;
  errorHttpStatusCode?: number;
  exceptionFactory?: (error: string) => unknown;
}

/** Per-version UUID patterns, matching the `uuid` validator in class-validator. */
const UUID_PATTERNS: Record<UUIDVersion, RegExp> = {
  3: /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  4: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  5: /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  all: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
};

/** The exact message Nest emits for a failed UUID parse. */
export const UUID_VALIDATION_FAILED_MESSAGE = 'Validation failed (uuid is expected)';

export function isUuid(value: unknown, version: UUIDVersion = 'all'): boolean {
  return typeof value === 'string' && UUID_PATTERNS[version].test(value);
}

export class ParseUUIDPipe {
  private readonly version: UUIDVersion;
  private readonly errorHttpStatusCode: number;
  private readonly exceptionFactory: (error: string) => unknown;

  constructor(options: ParseUUIDPipeOptions = {}) {
    this.version = options.version ?? 'all';
    this.errorHttpStatusCode = options.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST;
    this.exceptionFactory =
      options.exceptionFactory ??
      ((error: string) =>
        this.errorHttpStatusCode === HttpStatus.BAD_REQUEST
          ? new BadRequestException(error)
          : new HttpException(error, this.errorHttpStatusCode));
  }

  async transform(value: unknown): Promise<string> {
    if (!isUuid(value, this.version)) {
      throw this.exceptionFactory(UUID_VALIDATION_FAILED_MESSAGE);
    }
    return value as string;
  }
}

/** Convenience helper for route handlers: validate a path param or throw 400. */
export function parseUuidParam(value: unknown, version: UUIDVersion = 'all'): string {
  if (!isUuid(value, version)) {
    throw new BadRequestException(UUID_VALIDATION_FAILED_MESSAGE);
  }
  return value as string;
}
