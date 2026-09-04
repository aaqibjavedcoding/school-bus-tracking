/**
 * The HTTP response contract.
 *
 * These two functions are the exact behaviour of the old
 * `TransformInterceptor` and `HttpExceptionFilter`, re-expressed as pure
 * functions (no rxjs, no Nest). Every route handler goes through them, so the
 * success and error envelopes on the wire are unchanged.
 */
import type { ApiResponse } from '@school-bus-tracking/shared-types';
import { HttpException, HttpStatus, Logger } from '../framework';

const logger = new Logger('HttpExceptionFilter');

/**
 * Success envelope — the `TransformInterceptor` rule, verbatim.
 *
 * Two payload shapes are passed through untouched:
 * 1. anything that already carries `success` (a pre-built `ApiResponse`), and
 * 2. the health check, identified by having both `status` and `uptime`.
 */
export function wrapSuccess<T>(data: T): ApiResponse<T> | T {
  if (data && typeof data === 'object' && 'status' in data && 'uptime' in data) {
    return data;
  }
  if (data && typeof data === 'object' && 'success' in data) {
    return data;
  }
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  } as ApiResponse<T>;
}

/** The error envelope plus the status code it must be sent with. */
export interface ErrorEnvelope {
  status: number;
  body: ApiResponse;
}

/**
 * Error envelope — the `HttpExceptionFilter` rule, verbatim.
 *
 * - `code` is `response.error` when the exception body carries one,
 *   otherwise `HTTP_<status>`; a non-`HttpException` yields
 *   `INTERNAL_SERVER_ERROR`.
 * - `message` is forwarded as-is and may legitimately be a **string array**
 *   (validation failures).
 * - `details` is forwarded when present.
 * - 5xx responses are logged with the stack, 4xx are not.
 */
export function buildErrorEnvelope(
  exception: unknown,
  request?: { method?: string; url?: string },
): ErrorEnvelope {
  const status =
    exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

  const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;

  let errorMessage: unknown = 'Internal server error';
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let details: unknown = undefined;

  if (typeof exceptionResponse === 'string') {
    errorMessage = exceptionResponse;
  } else if (exceptionResponse && typeof exceptionResponse === 'object') {
    const respObj = exceptionResponse as Record<string, unknown>;
    errorMessage = respObj['message'] ?? errorMessage;
    errorCode = (respObj['error'] as string) || `HTTP_${status}`;
    details = respObj['details'] || undefined;
  } else if (exception instanceof Error) {
    errorMessage = exception.message;
  }

  if (status >= 500) {
    logger.error(
      `[${request?.method ?? 'UNKNOWN'}] ${request?.url ?? ''} - Status: ${status} - Error: ${String(
        errorMessage,
      )}`,
      exception instanceof Error ? exception.stack : undefined,
    );
  }

  return {
    status,
    body: {
      success: false,
      error: {
        code: errorCode,
        message: errorMessage as string,
        details,
      },
      timestamp: new Date().toISOString(),
    } as ApiResponse,
  };
}
