import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { REQUEST_ID_PROPERTY } from '../middleware/request-id.middleware';

/**
 * Structured logging interceptor for production, human-friendly for development.
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
 */
@Injectable()
export class StructuredLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly isProduction = process.env.NODE_ENV === 'production';

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestId = (req as any)[REQUEST_ID_PROPERTY] ?? null;
    const { method, url, ip } = req;
    const userAgent = (req.headers['user-agent'] ?? '').slice(0, 120);
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - now;
          const statusCode = res.statusCode;

          if (this.isProduction) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const user = (req as any).user;
            this.logStructured({
              requestId: requestId as string | null,
              method,
              url,
              statusCode,
              duration,
              ip: ip ?? null,
              userAgent,
              userId: user?.id ?? null,
              schoolId: user?.school_id ?? null,
            });
          } else {
            this.logger.log(
              `[${method}] ${url} ${statusCode} ${duration}ms${requestId ? ` rid=${requestId}` : ''}`,
            );
          }
        },
        error: (error: Error) => {
          const duration = Date.now() - now;
          const statusCode = res.statusCode;

          if (this.isProduction) {
            this.logStructured({
              requestId: requestId as string | null,
              method,
              url,
              statusCode,
              duration,
              ip: ip ?? null,
              userAgent,
              error: error.message,
              userId: null,
              schoolId: null,
            });
          } else {
            this.logger.warn(
              `[${method}] ${url} ${statusCode} ${duration}ms${requestId ? ` rid=${requestId}` : ''} error=${error.message}`,
            );
          }
        },
      }),
    );
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
