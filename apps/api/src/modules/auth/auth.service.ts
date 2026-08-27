import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthenticatedUser,
  JwtAccessTokenPayload,
  LoginResponse,
} from '@school-bus-tracking/shared-types';
import { comparePassword, normalizeEmail } from '../../auth';
import { User } from '../../database/models';
import { INVALID_CREDENTIALS_MESSAGE, USERS_REPOSITORY } from './auth.constants';
import { LoginDto } from './dto/login.dto';

/**
 * Valid bcrypt digest of a random throwaway value. When the looked-up user
 * does not exist (or has no credentials), we still run one bcrypt comparison
 * against this hash so the request takes roughly the same time as a real
 * password check — response timing must not reveal whether an account exists.
 */
const TIMING_EQUALIZATION_HASH = '$2b$12$soESu/j94RmCRdbw9np7i.i3xYN/EEH.2t.q0FleCvYHQqRvA.eIW';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: typeof User,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Tenant-scoped login: the user is looked up by `(school_id, email)` so an
   * email that exists under another school can never authenticate here.
   *
   * Every failure path throws the same generic 401 — never log or return
   * `password` / `password_hash`.
   */
  async login(dto: LoginDto): Promise<LoginResponse> {
    const email = normalizeEmail(dto.email);

    // `unscoped()` opts out of the default scope that hides `password_hash`;
    // the hash is needed here for comparison and is never returned.
    const user = await this.users.unscoped().findOne({
      where: { school_id: dto.school_id, email },
    });

    // Always perform exactly one bcrypt comparison (see TIMING_EQUALIZATION_HASH).
    const passwordMatches = await comparePassword(
      dto.password,
      user?.password_hash ?? TIMING_EQUALIZATION_HASH,
    );

    if (!user || !user.password_hash || !user.is_active || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const payload: JwtAccessTokenPayload = {
      sub: user.id,
      school_id: user.school_id,
      role: user.role,
    };

    // Secret and lifetime come from JwtModule, wired from `jwt.*` config
    // (environment) in AuthModule — never hard-coded here.
    const accessToken = await this.jwtService.signAsync({ ...payload });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.resolveExpiresIn(accessToken),
      user: this.toAuthenticatedUser(user),
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
