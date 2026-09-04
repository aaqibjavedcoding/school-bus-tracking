import { Logger } from '../../framework';
import { REQUEST_ID_PROPERTY } from '../middleware/request-id.middleware';

/**
 * Structured request logging for production, human-friendly for development.
 *
 * In production, emits JSON log lines with:
 * - request_id / correlation_id
 * - method, path, status code
 * - duration (ms)
 * - user agent (truncated)
 * - IP address
 * - user id (when authenticated)
 * - school id (when authenticated)
 *
 * In development, emits human-readable one-line summaries.
 *
 * Sensitive fields are redacted from logs.
 *
 * This was a Nest `NestInterceptor` wrapping the handler in an rxjs `tap`.
 * The route runtime is plain async/await, so the same two outcomes — success
 * and thrown error — are reported through {@link logSuccess} and
 * {@link logError} instead, with identical fields and log levels.
 */
export interface LoggableRequest {
  method: string;
  url: string;
  ip?: string | null;
  headers: Record<string, string | string[] | undefined>;
  user?: { id?: string | null; school_id?: string | null } | null;
  [REQUEST_ID_PROPERTY]?: unknown;
}

export class StructuredLogger {
  private readonly logger = new Logger('HTTP');
  private readonly isProduction = process.env.NODE_ENV === 'production';

  /** Milliseconds reference captured before the handler runs. */
  start(): number {
    return Date.now();
  }

  /** Successful response. */
  logSuccess(request: LoggableRequest, statusCode: number, startedAt: number): void {
    const duration = Date.now() - startedAt;

    if (this.isProduction) {
      const user = request.user;
      this.logStructured({
        requestId: this.requestId(request),
        method: request.method,
        url: request.url,
        statusCode,
        duration,
        ip: request.ip ?? null,
        userAgent: this.userAgent(request),
        userId: user?.id ?? null,
        schoolId: user?.school_id ?? null,
      });
      return;
    }

    const requestId = this.requestId(request);
    this.logger.log(
      `[${request.method}] ${request.url} ${statusCode} ${duration}ms${
        requestId ? ` rid=${requestId}` : ''
      }`,
    );
  }

  /** Failed response; mirrors the interceptor's `error` branch exactly. */
  logError(
    request: LoggableRequest,
    statusCode: number,
    startedAt: number,
    error: Error,
  ): void {
    const duration = Date.now() - startedAt;

    if (this.isProduction) {
      this.logStructured({
        requestId: this.requestId(request),
        method: request.method,
        url: request.url,
        statusCode,
        duration,
        ip: request.ip ?? null,
        userAgent: this.userAgent(request),
        error: error.message,
        userId: null,
        schoolId: null,
      });
      return;
    }

    const requestId = this.requestId(request);
    this.logger.warn(
      `[${request.method}] ${request.url} ${statusCode} ${duration}ms${
        requestId ? ` rid=${requestId}` : ''
      } error=${error.message}`,
    );
  }

  private requestId(request: LoggableRequest): string | null {
    const value = request[REQUEST_ID_PROPERTY];
    return typeof value === 'string' ? value : null;
  }

  private userAgent(request: LoggableRequest): string {
    const value = request.headers['user-agent'];
    const raw = Array.isArray(value) ? value[0] : value;
    return (raw ?? '').slice(0, 120);
  }

  private logStructured(data: {
    requestId: string | null;
    method: string;
    url: string;
    statusCode: number;
    duration: number;
    ip: string | null;
    userAgent: string;
    userId?: string | null;
    schoolId?: string | null;
    error?: string;
  }): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level: data.error ? 'warn' : 'info',
      request_id: data.requestId,
      method: data.method,
      path: data.url,
      status: data.statusCode,
      duration_ms: data.duration,
      ip: data.ip,
      user_agent: data.userAgent,
      user_id: data.userId ?? undefined,
      school_id: data.schoolId ?? undefined,
      error: data.error ?? undefined,
    };

    // Use the appropriate log level.
    if (data.error || data.statusCode >= 500) {
      this.logger.warn(JSON.stringify(entry));
    } else {
      this.logger.log(JSON.stringify(entry));
    }
  }
}

/** Process-wide logger; stateless, so a single instance is safe to share. */
export const structuredLogger = new StructuredLogger();
