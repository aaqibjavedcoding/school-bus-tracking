import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { LoginResponse, LogoutResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { parseCookieHeader } from '../../auth';
import { RateLimit } from '../../common/rate-limit';
import {
  buildCsrfClearCookieOptions,
  buildCsrfCookieOptions,
  generateCsrfToken,
} from '../../common/security';

/** Payload of `GET /api/v1/auth/csrf`. */
export interface CsrfTokenResponse {
  csrf_token: string;
  header_name: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    /**
     * Optional so the controller stays trivially unit-constructible
     * (`new AuthController(authService)`, as the existing tests do). In the
     * running application Nest injects the global `ConfigService`, which
     * supplies the CSRF cookie policy.
     */
    private readonly configService?: ConfigService,
  ) {}

  /**
   * `POST /api/v1/auth/login`
   *
   * Validates user credentials, returns an access token in the JSON envelope,
   * and sets an httpOnly + secure refresh token cookie.
   *
   * Rate limited per IP *and* per submitted identity (`school + email`) so
   * credential stuffing is throttled even when spread across many IPs. Both
   * windows expire on their own — a legitimate user is never locked out
   * permanently.
   */
  @Post('login')
  @RateLimit('auth_login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { response, refreshToken } = await this.authService.login(dto);
    this.setRefreshTokenCookie(req, res, refreshToken);
    this.issueCsrfToken(req, res);
    return response;
  }

  /**
   * `POST /api/v1/auth/refresh`
   *
   * Validates the refresh token from the cookie, rotates it by revoking the old
   * token and issuing a new one, sets the new refresh token cookie, and returns
   * a fresh access token in the JSON envelope.
   */
  @Post('refresh')
  @RateLimit('auth_refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const rawRefreshToken = this.extractRefreshToken(req);
    const { response, refreshToken } = await this.authService.refresh(rawRefreshToken);
    this.setRefreshTokenCookie(req, res, refreshToken);
    this.issueCsrfToken(req, res);
    return response;
  }

  /**
   * `POST /api/v1/auth/logout`
   *
   * Revokes the current refresh token session in the database and clears the
   * refresh token cookie.
   */
  @Post('logout')
  @RateLimit('auth_logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponse> {
    const rawRefreshToken = this.extractRefreshToken(req);
    const result = await this.authService.logout(rawRefreshToken);
    this.clearRefreshTokenCookie(req, res);
    this.clearCsrfCookie(req, res);
    return result;
  }

  /**
   * `GET /api/v1/auth/csrf`
   *
   * Bootstraps the double-submit CSRF cookie for a browser client that has a
   * session cookie but no token yet (for example after a full page reload).
   * Safe by construction: the token is not a credential — it only proves that
   * a same-site script, rather than an attacker's page, issued the request.
   */
  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  getCsrfToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): CsrfTokenResponse {
    const token = this.issueCsrfToken(req, res);
    return {
      csrf_token: token,
      header_name: this.configService?.get<string>('security.csrf.headerName') ?? 'x-csrf-token',
    };
  }

  private extractRefreshToken(req: Request): string | undefined {
    const cookieName = this.authService.getRefreshCookieName();

    // 1. From parsed cookies (via cookie-parser middleware)
    if (req?.cookies && req.cookies[cookieName]) {
      return req.cookies[cookieName];
    }

    // 2. Fallback: parse raw Cookie header if middleware was bypassed
    if (req?.headers?.cookie) {
      const parsed = parseCookieHeader(req.headers.cookie);
      if (parsed[cookieName]) {
        return parsed[cookieName];
      }
    }

    // 3. Opt-in fallback: request body for a non-browser HTTP client that
    //    cannot keep a cookie jar. Disabled by default
    //    (`AUTH_ALLOW_REFRESH_TOKEN_IN_BODY`): both first-party clients use
    //    the httpOnly cookie, and accepting a body token widens the surface
    //    for token replay through logs/proxies.
    if (
      this.isBodyRefreshTokenAllowed() &&
      req?.body &&
      typeof req.body === 'object' &&
      req.body.refresh_token
    ) {
      return req.body.refresh_token;
    }

    return undefined;
  }

  private isBodyRefreshTokenAllowed(): boolean {
    return this.configService?.get<boolean>('security.allowRefreshTokenInBody') === true;
  }

  private isHttpsRequest(req: Request): boolean {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const firstForwardedProto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(',')[0];
    return req.secure || firstForwardedProto?.trim().toLowerCase() === 'https';
  }

  private setRefreshTokenCookie(req: Request, res: Response, refreshToken: string): void {
    const cookieName = this.authService.getRefreshCookieName();
    const cookieOptions = this.authService.getRefreshCookieOptions(this.isHttpsRequest(req));
    res.cookie(cookieName, refreshToken, cookieOptions);
  }

  private clearRefreshTokenCookie(req: Request, res: Response): void {
    const cookieName = this.authService.getRefreshCookieName();
    const clearOptions = this.authService.getClearCookieOptions(this.isHttpsRequest(req));
    res.clearCookie(cookieName, clearOptions);
  }

  /** Issues (or rotates) the readable double-submit CSRF cookie. */
  private issueCsrfToken(req: Request, res: Response): string {
    const token = generateCsrfToken();
    res.cookie(this.csrfCookieName(), token, buildCsrfCookieOptions(this.csrfCookieInput(req)));
    return token;
  }

  private clearCsrfCookie(req: Request, res: Response): void {
    res.clearCookie(
      this.csrfCookieName(),
      buildCsrfClearCookieOptions(this.csrfCookieInput(req)),
    );
  }

  private csrfCookieName(): string {
    return this.configService?.get<string>('security.csrf.cookieName') ?? 'csrf_token';
  }

  private csrfCookieInput(req: Request) {
    return {
      isProduction: this.configService?.get<boolean>('security.isProduction') === true,
      isHttpsRequest: this.isHttpsRequest(req),
      ttlMs: this.configService?.get<number>('security.csrf.ttlMs') ?? 12 * 60 * 60 * 1000,
    };
  }
}
