import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { parseCookieHeader } from '../../auth';
import { CorsPolicy, isOriginAllowed, resolveCorsPolicy } from './cors';
import {
  CSRF_INVALID_MESSAGE,
  CSRF_ORIGIN_REJECTED_MESSAGE,
  evaluateCsrf,
} from './csrf';

/**
 * Global guard enforcing {@link evaluateCsrf} on every state-changing request.
 *
 * Registered as an `APP_GUARD` so a new controller cannot forget it. The rule
 * itself is a pure function (`csrf.ts`) and unit-tested independently; this
 * class only adapts the Express request onto it.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly enabled: boolean;
  private readonly cookieName: string;
  private readonly headerName: string;
  private readonly sessionCookieName: string;
  private readonly corsPolicy: CorsPolicy;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('security.csrf.enabled', true);
    this.cookieName = this.configService.get<string>('security.csrf.cookieName', 'csrf_token');
    this.headerName = this.configService.get<string>('security.csrf.headerName', 'x-csrf-token');
    this.sessionCookieName = this.configService.get<string>(
      'jwt.refreshCookieName',
      'refresh_token',
    );
    this.corsPolicy = resolveCorsPolicy({
      isProduction: this.configService.get<boolean>('security.isProduction', false),
      corsOrigins: this.configService.get<string[]>('security.corsOrigins', []),
      credentials: this.configService.get<boolean>('security.corsCredentials', true),
    });
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) {
      return true;
    }
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const origin = firstHeader(request.headers?.origin) ?? null;
    const cookies = readCookies(request);

    const decision = evaluateCsrf({
      method: request.method ?? 'GET',
      origin,
      originAllowed: isOriginAllowed(this.corsPolicy, origin),
      hasBearerToken: hasBearerToken(request.headers?.authorization),
      hasSessionCookie: Boolean(cookies[this.sessionCookieName]),
      cookieToken: cookies[this.cookieName] ?? null,
      headerToken: firstHeader(request.headers?.[this.headerName]) ?? null,
    });

    if (decision.allowed) {
      return true;
    }

    throw new ForbiddenException(
      decision.reason === 'origin-rejected' ? CSRF_ORIGIN_REJECTED_MESSAGE : CSRF_INVALID_MESSAGE,
    );
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function hasBearerToken(authorization: string | string[] | undefined): boolean {
  const raw = firstHeader(authorization);
  return typeof raw === 'string' && /^bearer\s+\S+$/i.test(raw.trim());
}

function readCookies(request: Request): Record<string, string> {
  const parsed = (request as { cookies?: Record<string, string> }).cookies;
  if (parsed && typeof parsed === 'object') {
    return parsed;
  }
  const header = firstHeader(request.headers?.cookie);
  return header ? parseCookieHeader(header) : {};
}
