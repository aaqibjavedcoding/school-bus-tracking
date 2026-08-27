import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoginResponse, LogoutResponse, RefreshResponse } from '@school-bus-tracking/shared-types';
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
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { response, refreshToken } = await this.authService.login(dto);
    this.setRefreshTokenCookie(res, refreshToken);
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
    this.setRefreshTokenCookie(res, refreshToken);
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
    this.clearRefreshTokenCookie(res);
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

  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    const cookieName = this.authService.getRefreshCookieName();
    const cookieOptions = this.authService.getRefreshCookieOptions();
    res.cookie(cookieName, refreshToken, cookieOptions);
  }

  private clearRefreshTokenCookie(res: Response): void {
    const cookieName = this.authService.getRefreshCookieName();
    const clearOptions = this.authService.getClearCookieOptions();
    res.clearCookie(cookieName, clearOptions);
  }
}
