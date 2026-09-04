/**
 * Framework-native HTTP exception hierarchy.
 *
 * This is a faithful, dependency-free reimplementation of the subset of
 * `@nestjs/common`'s exception surface that this codebase relies on. The
 * observable contract is byte-for-byte identical to Nest's:
 *
 * - `getStatus()` returns the numeric status code.
 * - `getResponse()` returns either the raw string passed by the caller, or
 *   the object `{ statusCode, message, error }` that Nest synthesizes when a
 *   plain message string is given, or the caller's own object verbatim.
 *
 * `HttpExceptionFilter` reads `error` for the error code and `message` for
 * the message, so preserving this shape preserves the wire format exactly.
 */

/** Numeric HTTP status codes (mirrors `@nestjs/common`'s HttpStatus enum). */
export enum HttpStatus {
  CONTINUE = 100,
  SWITCHING_PROTOCOLS = 101,
  PROCESSING = 102,
  EARLYHINTS = 103,
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NON_AUTHORITATIVE_INFORMATION = 203,
  NO_CONTENT = 204,
  RESET_CONTENT = 205,
  PARTIAL_CONTENT = 206,
  AMBIGUOUS = 300,
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  SEE_OTHER = 303,
  NOT_MODIFIED = 304,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  PAYMENT_REQUIRED = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  PROXY_AUTHENTICATION_REQUIRED = 407,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  LENGTH_REQUIRED = 411,
  PRECONDITION_FAILED = 412,
  PAYLOAD_TOO_LARGE = 413,
  URI_TOO_LONG = 414,
  UNSUPPORTED_MEDIA_TYPE = 415,
  REQUESTED_RANGE_NOT_SATISFIABLE = 416,
  EXPECTATION_FAILED = 417,
  I_AM_A_TEAPOT = 418,
  MISDIRECTED = 421,
  UNPROCESSABLE_ENTITY = 422,
  FAILED_DEPENDENCY = 424,
  PRECONDITION_REQUIRED = 428,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
  HTTP_VERSION_NOT_SUPPORTED = 505,
}

/** The payload carried by an {@link HttpException}. */
export type HttpExceptionBody = string | Record<string, unknown>;

/**
 * Base HTTP exception.
 *
 * Mirrors Nest semantics: the `response` given to the constructor is returned
 * verbatim by {@link getResponse}, and `message` is derived from it for the
 * standard `Error.message` property.
 */
export class HttpException extends Error {
  constructor(
    private readonly response: HttpExceptionBody,
    private readonly status: number,
  ) {
    super(deriveErrorMessage(response));
    this.name = new.target.name;
    // Restores the prototype chain when compiled down to ES5-style output, so
    // `instanceof HttpException` keeps working for subclasses.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  getStatus(): number {
    return this.status;
  }

  getResponse(): HttpExceptionBody {
    return this.response;
  }
}

/** Extracts a human-readable `Error.message` from an exception payload. */
function deriveErrorMessage(response: HttpExceptionBody): string {
  if (typeof response === 'string') {
    return response;
  }
  const message = (response as Record<string, unknown>)['message'];
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.join(', ');
  }
  return 'Http Exception';
}

/**
 * Builds the response body exactly the way Nest's built-in exceptions do.
 *
 * When the caller passes a plain string (or nothing), Nest synthesizes
 * `{ statusCode, message, error }` where `error` is the canonical reason
 * phrase. When the caller passes an object, it is used verbatim — which is
 * how the codebase attaches `details` and custom `error` codes.
 */
function buildBody(
  objectOrMessage: HttpExceptionBody | undefined,
  status: number,
  error: string,
): HttpExceptionBody {
  if (objectOrMessage === undefined) {
    return { statusCode: status, message: error, error };
  }
  if (typeof objectOrMessage === 'string') {
    return { statusCode: status, message: objectOrMessage, error };
  }
  return objectOrMessage;
}

export class BadRequestException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(buildBody(objectOrMessage, HttpStatus.BAD_REQUEST, 'Bad Request'), HttpStatus.BAD_REQUEST);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(
      buildBody(objectOrMessage, HttpStatus.UNAUTHORIZED, 'Unauthorized'),
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ForbiddenException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(buildBody(objectOrMessage, HttpStatus.FORBIDDEN, 'Forbidden'), HttpStatus.FORBIDDEN);
  }
}

export class NotFoundException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(buildBody(objectOrMessage, HttpStatus.NOT_FOUND, 'Not Found'), HttpStatus.NOT_FOUND);
  }
}

export class ConflictException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(buildBody(objectOrMessage, HttpStatus.CONFLICT, 'Conflict'), HttpStatus.CONFLICT);
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(
      buildBody(objectOrMessage, HttpStatus.PAYLOAD_TOO_LARGE, 'Payload Too Large'),
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(
      buildBody(objectOrMessage, HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'Unsupported Media Type'),
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(
      buildBody(objectOrMessage, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal Server Error'),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(objectOrMessage?: HttpExceptionBody) {
    super(
      buildBody(objectOrMessage, HttpStatus.SERVICE_UNAVAILABLE, 'Service Unavailable'),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
