import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';

/**
 * Non-sensitive user context attached to `request.user` once the bearer
 * access token has been verified.
 *
 * Derived exclusively from the verified token claims (`sub`, `school_id`,
 * `role`) — it never includes credentials, email, or personal details.
 */
export interface AuthenticatedRequestUser {
  id: string;
  school_id: string;
  role: UserRole;
}

/** Generic message when the Authorization header is absent or malformed. */
export const MISSING_AUTH_TOKEN_MESSAGE = 'Missing bearer access token';

/**
 * Generic message when the token fails verification (bad signature, expired,
 * or malformed claims). Details are deliberately not leaked.
 */
export const INVALID_AUTH_TOKEN_MESSAGE = 'Invalid or expired access token';

/** Canonical role values accepted inside an access token payload. */
const VALID_ROLES: readonly string[] = Object.values(UserRole);

/**
 * Structural validation of a verified access-token payload.
 *
 * A cryptographically valid token is not enough — the payload must carry the
 * complete tenant-scoped claim set (`sub`, `school_id`, `role`) with a
 * recognized role. This is the single implementation of that rule: the HTTP
 * `JwtAuthGuard` and the live-tracking Socket.IO gateway both rely on it so
 * the two authentication surfaces can never drift.
 */
export function isAccessTokenPayloadValid(payload: unknown): payload is JwtAccessTokenPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Partial<JwtAccessTokenPayload>;
  return (
    typeof candidate.sub === 'string' &&
    candidate.sub.length > 0 &&
    typeof candidate.school_id === 'string' &&
    candidate.school_id.length > 0 &&
    typeof candidate.role === 'string' &&
    VALID_ROLES.includes(candidate.role)
  );
}

/** Minimal shape of the incoming request the guard interacts with. */
interface RequestWithUser {
  headers?: Record<string, unknown>;
  user?: AuthenticatedRequestUser;
}

/**
 * Route guard that authenticates requests via a JWT bearer access token.
 *
 * - Reads `Authorization: Bearer <access_token>`.
 * - Verifies the token with the existing JWT configuration (the same secret
 *   and expiry registered by `AuthModule`'s global `JwtModule`).
 * - Attaches the authenticated user (token claims only) to `request.user` for
 *   `@CurrentUser()`.
 * - Any missing, malformed, invalid, or expired token results in `401`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const token = this.extractBearerToken(request?.headers?.authorization);

    if (!token) {
      throw new UnauthorizedException(MISSING_AUTH_TOKEN_MESSAGE);
    }

    let payload: JwtAccessTokenPayload;

    try {
      // The injected `JwtService` already carries the secret and expiry from
      // the central JWT configuration — nothing is re-declared here.
      payload = await this.jwtService.verifyAsync<JwtAccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_AUTH_TOKEN_MESSAGE);
    }

    if (!this.isValidPayload(payload)) {
      throw new UnauthorizedException(INVALID_AUTH_TOKEN_MESSAGE);
    }

    request.user = {
      id: payload.sub,
      school_id: payload.school_id,
      role: payload.role,
    };

    return true;
  }

  /**
   * Extracts the raw token from an `Authorization` header. The `Bearer`
   * scheme is matched case-insensitively per RFC 7235; exactly one token
   * segment must follow it.
   */
  private extractBearerToken(authorizationHeader: unknown): string | null {
    if (typeof authorizationHeader !== 'string') {
      return null;
    }

    const parts = authorizationHeader.trim().split(/\s+/);
    const [scheme, token, ...rest] = parts;

    if (!scheme || scheme.toLowerCase() !== 'bearer') {
      return null;
    }

    if (!token || rest.length > 0) {
      return null;
    }

    return token;
  }

  /** Delegates to the shared payload rule (see `isAccessTokenPayloadValid`). */
  private isValidPayload(payload: unknown): payload is JwtAccessTokenPayload {
    return isAccessTokenPayloadValid(payload);
  }
}
