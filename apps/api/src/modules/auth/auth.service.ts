import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions } from 'express';
import {
  AuthenticatedUser,
  JwtAccessTokenPayload,
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  comparePassword,
  generateRefreshToken,
  hashToken,
  normalizeEmail,
  parseDurationToMs,
} from '../../auth';
import { SCHOOL_INACTIVE_MESSAGE, SchoolAccessService } from '../../common/access';
import { RefreshToken, School, User } from '../../database/models';
import {
  AUTH_SCHOOLS_REPOSITORY,
  DEFAULT_REFRESH_COOKIE_NAME,
  EXPIRED_REFRESH_TOKEN_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_REFRESH_TOKEN_MESSAGE,
  LOGOUT_SUCCESS_MESSAGE,
  REFRESH_TOKENS_REPOSITORY,
  REVOKED_REFRESH_TOKEN_MESSAGE,
  USERS_REPOSITORY,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';

/**
 * Valid bcrypt digest of a random throwaway value. When the looked-up user
 * does not exist (or has no credentials), we still run one bcrypt comparison
 * against this hash so the request takes roughly the same time as a real
 * password check — response timing must not reveal whether an account exists.
 */
const TIMING_EQUALIZATION_HASH = '$2b$12$soESu/j94RmCRdbw9np7i.i3xYN/EEH.2t.q0FleCvYHQqRvA.eIW';

/** Canonical RFC 4122 UUID (any variant / version), used to tell a raw tenant
 * UUID apart from a human-friendly school `code` at login. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuthSessionResult<T = LoginResponse | RefreshResponse> {
  response: T;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: typeof User,
    @Inject(REFRESH_TOKENS_REPOSITORY) private readonly refreshTokens: typeof RefreshToken,
    private readonly jwtService: JwtService,
    private readonly configService?: ConfigService,
    /**
     * Centralized school-lifecycle check. Optional so the service stays
     * trivially unit-constructible (existing tests instantiate it with four
     * arguments); the global `AccessModule` injects the real service in the
     * running application.
     */
    private readonly schoolAccess?: SchoolAccessService,
    /**
     * `School` model used to resolve a tenant `code` supplied at login into
     * its `school_id`. Optional so the service stays unit-constructible: a raw
     * UUID needs no school lookup, and existing tests that pass a UUID never
     * touch this dependency.
     */
    @Inject(AUTH_SCHOOLS_REPOSITORY)
    private readonly schools?: typeof School,
  ) {}

  /**
   * Login.
   *
   * - School users (SCHOOL_ADMIN, DRIVER, CONDUCTOR, PARENT) are tenant
   *   scoped: looked up by `(school_id, email)` so an email that exists under
   *   another school can never authenticate here.
   * - A platform SUPER_ADMIN belongs to no tenant: it logs in with no
   *   `school_id` and is looked up by email across the platform.
   *
   * Creates an access token and a hashed refresh token session in the
   * database. A deactivated tenant is refused with the generic
   * `School is inactive` business error.
   */
  async login(dto: LoginDto): Promise<AuthSessionResult<LoginResponse>> {
    const email = normalizeEmail(dto.email);
    const isPlatformLogin = dto.school_id === null || dto.school_id === undefined;

    // A school user identifies the tenant either by its raw UUID or by its
    // human-friendly `code`. Resolve the code to the tenant id; if the code is
    // unknown (`schoolId === null`) we must NOT hand the raw code to a
    // tenant-scoped lookup — `users.school_id` is a PostgreSQL UUID and would
    // surface a 500 "invalid input syntax for type uuid". Instead we skip the
    // query and let the generic credential failure below run, which keeps the
    // response (and its timing) identical to a wrong password / unknown email
    // so an attacker cannot probe which tenant codes exist.
    const schoolId = isPlatformLogin
      ? null
      : await this.resolveTenantId((dto.school_id as string).trim());

    // `unscoped()` opts out of the default scope that hides `password_hash`;
    // the hash is needed here for comparison and is never returned.
    const user =
      isPlatformLogin || schoolId
        ? await this.users.unscoped().findOne({
            where: isPlatformLogin
              ? { email, role: UserRole.SUPER_ADMIN, school_id: null }
              : { school_id: schoolId, email },
          })
        : null;

    // Always perform exactly one bcrypt comparison (see TIMING_EQUALIZATION_HASH).
    const passwordMatches = await comparePassword(
      dto.password,
      user?.password_hash ?? TIMING_EQUALIZATION_HASH,
    );

    if (!user || !user.password_hash || !user.is_active || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // A school login must not cross into the platform tenant and vice versa:
    // a school id supplied for a SUPER_ADMIN row, or missing for a school
    // user, is treated as invalid credentials rather than a login.
    const platformUser = user.role === UserRole.SUPER_ADMIN;
    if (platformUser !== isPlatformLogin || (platformUser && user.school_id !== null)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // Centralized lifecycle enforcement: a deactivated tenant cannot log in.
    // Checked only after the password is verified so existence/state of a
    // tenant cannot be probed with an arbitrary email.
    if (!platformUser && this.schoolAccess) {
      const accessible = await this.schoolAccess.isSchoolAccessible(user.school_id);
      if (!accessible) {
        throw new ForbiddenException(SCHOOL_INACTIVE_MESSAGE);
      }
    }

    const payload: JwtAccessTokenPayload = {
      sub: user.id,
      school_id: user.school_id,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync({ ...payload });
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + this.getRefreshTtlMs());

    await this.refreshTokens.create({
      school_id: user.school_id,
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked_at: null,
      replaced_by_token_id: null,
    } as unknown as RefreshToken);

    return {
      response: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.resolveExpiresIn(accessToken),
        user: this.toAuthenticatedUser(user),
      },
      refreshToken: rawRefreshToken,
    };
  }

  /**
   * Validates a refresh token, performs token rotation, and returns a new access token.
   *
   * Security constraints:
   * - Refresh token must exist in the database.
   * - Refresh token must not have been revoked.
   * - Refresh token must not have expired.
   * - The associated user account must still exist and be active.
   * - Rotation: Old token is revoked and linked to the new token (`replaced_by_token_id`).
   */
  async refresh(rawRefreshToken: string | undefined): Promise<AuthSessionResult<RefreshResponse>> {
    if (!rawRefreshToken || typeof rawRefreshToken !== 'string' || !rawRefreshToken.trim()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    const tokenHash = hashToken(rawRefreshToken.trim());
    const storedToken = await this.refreshTokens.unscoped().findOne({
      where: { token_hash: tokenHash },
    });

    if (!storedToken) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (storedToken.revoked_at !== null) {
      throw new UnauthorizedException(REVOKED_REFRESH_TOKEN_MESSAGE);
    }

    if (new Date(storedToken.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException(EXPIRED_REFRESH_TOKEN_MESSAGE);
    }

    const user = await this.users.unscoped().findOne({
      where: { id: storedToken.user_id, school_id: storedToken.school_id },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // A deactivated tenant must not be able to refresh an existing session.
    // SUPER_ADMIN sessions carry a null school and always pass.
    if (user.role !== UserRole.SUPER_ADMIN && this.schoolAccess) {
      const accessible = await this.schoolAccess.isSchoolAccessible(user.school_id);
      if (!accessible) {
        throw new ForbiddenException(SCHOOL_INACTIVE_MESSAGE);
      }
    }

    const newRawRefreshToken = generateRefreshToken();
    const newTokenHash = hashToken(newRawRefreshToken);
    const newExpiresAt = new Date(Date.now() + this.getRefreshTtlMs());

    const newStoredToken = await this.refreshTokens.create({
      school_id: user.school_id,
      user_id: user.id,
      token_hash: newTokenHash,
      expires_at: newExpiresAt,
      revoked_at: null,
      replaced_by_token_id: null,
    } as unknown as RefreshToken);

    storedToken.revoked_at = new Date();
    storedToken.replaced_by_token_id = newStoredToken.id;
    await storedToken.save();

    const payload: JwtAccessTokenPayload = {
      sub: user.id,
      school_id: user.school_id,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync({ ...payload });

    return {
      response: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.resolveExpiresIn(accessToken),
        user: this.toAuthenticatedUser(user),
      },
      refreshToken: newRawRefreshToken,
    };
  }

  /**
   * Revokes the refresh token session in the database.
   * Idempotent: succeeds even if no token is provided or already revoked.
   */
  async logout(rawRefreshToken: string | undefined): Promise<LogoutResponse> {
    if (rawRefreshToken && typeof rawRefreshToken === 'string' && rawRefreshToken.trim()) {
      const tokenHash = hashToken(rawRefreshToken.trim());
      const storedToken = await this.refreshTokens.unscoped().findOne({
        where: { token_hash: tokenHash },
      });

      if (storedToken && storedToken.revoked_at === null) {
        storedToken.revoked_at = new Date();
        await storedToken.save();
      }
    }

    return {
      message: LOGOUT_SUCCESS_MESSAGE,
    };
  }

  /**
   * Resolves the tenant identifier supplied at login to a `school_id`.
   *
   * A canonical UUID is returned unchanged. Anything else is treated as the
   * school's tenant `code` and looked up on the `School` model; an unknown
   * code resolves to `null` so the caller can fall through to the generic
   * credential failure. Enforces the same trailing/leading space trimming and
   * lower-casing used at provisioning (`normalizeEmail`-style) so a code a
   * school admin types is matched consistently.
   */
  private async resolveTenantId(identifier: string): Promise<string | null> {
    if (UUID_PATTERN.test(identifier)) {
      return identifier;
    }
    if (!this.schools) {
      return null;
    }
    const school = await this.schools.findOne({ where: { code: identifier.toLowerCase() } });
    return school ? school.id : null;
  }

  getRefreshCookieName(): string {
    return this.configService?.get<string>('jwt.refreshCookieName') ?? DEFAULT_REFRESH_COOKIE_NAME;
  }

  getRefreshTtlMs(): number {
    const rawTtl = this.configService?.get<string>('jwt.refreshExpiresIn');
    return parseDurationToMs(rawTtl);
  }

  getRefreshCookieOptions(): CookieOptions {
    const isProduction = this.configService?.get<string>('app.nodeEnv') === 'production';
    const apiPrefix = this.configService?.get<string>('app.apiPrefix', 'api/v1') ?? 'api/v1';
    const normalizedPrefix = apiPrefix.replace(/^\/+|\/+$/g, '');
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: `/${normalizedPrefix}/auth`,
      maxAge: this.getRefreshTtlMs(),
    };
  }

  getClearCookieOptions(): CookieOptions {
    const isProduction = this.configService?.get<string>('app.nodeEnv') === 'production';
    const apiPrefix = this.configService?.get<string>('app.apiPrefix', 'api/v1') ?? 'api/v1';
    const normalizedPrefix = apiPrefix.replace(/^\/+|\/+$/g, '');
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: `/${normalizedPrefix}/auth`,
    };
  }

  /** Derive the token lifetime in seconds from the issued token itself. */
  private resolveExpiresIn(accessToken: string): number {
    const decoded = this.jwtService.decode<{ exp?: number; iat?: number } | null>(accessToken);
    if (decoded?.exp !== undefined && decoded?.iat !== undefined) {
      return decoded.exp - decoded.iat;
    }
    return 0;
  }

  /** Explicit field-by-field projection — credentials can never leak. */
  private toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      school_id: user.school_id,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
    };
  }
}
