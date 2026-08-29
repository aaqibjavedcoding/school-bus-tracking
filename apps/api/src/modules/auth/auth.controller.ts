import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CLIENT_SESSION_HEADER,
  CLIENT_SESSION_REFRESH_TOKEN_BODY,
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
} from '@school-bus-tracking/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { parseCookieHeader } from '../../auth';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /api/v1/auth/login`
   *
   * Validates user credentials, returns an access token in the JSON envelope,
   * and sets an httpOnly + secure refresh token cookie.
   *
   * Non-browser session clients (the Expo mobile app has no cookie jar) opt
   * into receiving the raw refresh token in the JSON body as well by sending
   * `x-client-session: refresh-token-body`; browsers never send it, so the
   * browser-facing response shape is unchanged. The mobile client stores the
   * token in device-protected storage and replays it as `body.refresh_token`
   * on refresh/logout (see `extractRefreshToken`).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { response, refreshToken } = await this.authService.login(dto);
    this.setRefreshTokenCookie(req, res, refreshToken);
    if (this.wantsRefreshTokenInBody(req)) {
      return { ...response, refresh_token: refreshToken };
    }
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
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const rawRefreshToken = this.extractRefreshToken(req);
    const { response, refreshToken } = await this.authService.refresh(rawRefreshToken);
    this.setRefreshTokenCookie(req, res, refreshToken);
    if (this.wantsRefreshTokenInBody(req)) {
      return { ...response, refresh_token: refreshToken };
    }
    return response;
  }

  /**
   * `POST /api/v1/auth/logout`
   *
   * Revokes the current refresh token session in the database and clears the
   * refresh token cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponse> {
    const rawRefreshToken = this.extractRefreshToken(req);
    const result = await this.authService.logout(rawRefreshToken);
    this.clearRefreshTokenCookie(req, res);
    return result;
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

    // 3. Fallback: request body for non-browser HTTP clients
    if (req?.body && typeof req.body === 'object' && req.body.refresh_token) {
      return req.body.refresh_token;
    }

    return undefined;
  }

  /**
   * True when a non-browser client asked for the refresh token to be returned
   * in the JSON response body (`x-client-session: refresh-token-body`).
   *
   * Checked case-insensitively because `req.headers` lower-cases header names
   * on Node, and a raw client may spell the header differently.
   */
  private wantsRefreshTokenInBody(req: Request): boolean {
    const value = req?.headers?.[CLIENT_SESSION_HEADER];
    return Array.isArray(value)
      ? value.includes(CLIENT_SESSION_REFRESH_TOKEN_BODY)
      : value === CLIENT_SESSION_REFRESH_TOKEN_BODY;
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
}
