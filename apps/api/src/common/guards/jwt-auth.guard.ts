import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAccessTokenPayload, UserRole } from '@school-bus-tracking/shared-types';
import { SCHOOL_INACTIVE_MESSAGE, SchoolAccessService } from '../access';

/**
 * Non-sensitive user context attached to `request.user` once the bearer
 * access token has been verified.
 *
 * Derived exclusively from the verified token claims (`sub`, `school_id`,
 * `role`) — it never includes credentials, email, or personal details.
 */
export interface AuthenticatedRequestUser {
  id: string;
  /** Tenant id for school users; null for the platform SUPER_ADMIN. */
  school_id: string | null;
  role: UserRole;
}

/**
 * Non-null tenant context for school-scoped services.
 *
 * Tenant feature controllers are reachable only by non-platform roles whose
 * payload validation guarantees a non-empty `school_id`; they pass this
 * narrowed type to their services. The platform `/admin/*` surface never
 * uses the JWT tenant — it manages schools through route parameters.
 */
export type TenantRequestUser = Omit<AuthenticatedRequestUser, 'school_id'> & {
  school_id: string;
};

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
 * complete claim set (`sub`, `school_id`, `role`) with a recognized role.
 * `school_id` is a non-empty tenant id for every school-scoped role and
 * `null` for the platform `SUPER_ADMIN`, which belongs to no tenant. This is
 * the single implementation of that rule: the HTTP `JwtAuthGuard` and the
 * live-tracking Socket.IO gateway both rely on it so the two authentication
 * surfaces can never drift.
 */
export function isAccessTokenPayloadValid(payload: unknown): payload is JwtAccessTokenPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const candidate = payload as Partial<JwtAccessTokenPayload>;
  if (
    typeof candidate.sub !== 'string' ||
    candidate.sub.length === 0 ||
    typeof candidate.role !== 'string' ||
    !VALID_ROLES.includes(candidate.role)
  ) {
    return false;
  }
  if (candidate.role === UserRole.SUPER_ADMIN) {
    // Platform accounts are not tenants: school_id must be absent/null.
    return candidate.school_id === null || candidate.school_id === undefined;
  }
  // Every other role is a school user and must carry a real tenant id.
  return typeof candidate.school_id === 'string' && candidate.school_id.length > 0;
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
  /**
   * The school-lifecycle check is optional so this guard stays trivially
   * unit-constructible (`new JwtAuthGuard(jwtService)`, matching the existing
   * tests). In a running Nest application the global `AccessModule` injects
   * the real {@link SchoolAccessService}.
   */
  constructor(
    private readonly jwtService: JwtService,
    private readonly schoolAccess?: SchoolAccessService,
  ) {}

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

    // Centralized school-lifecycle enforcement: once a tenant is deactivated
    // its existing access tokens must stop granting access, immediately. The
    // platform SUPER_ADMIN has no school claim (null) and always passes so it
    // can keep managing inactive tenants — no lookup is made for it.
    if (this.schoolAccess && payload.role !== UserRole.SUPER_ADMIN) {
      const accessible = await this.schoolAccess.isSchoolAccessible(payload.school_id);
      if (!accessible) {
        throw new ForbiddenException(SCHOOL_INACTIVE_MESSAGE);
      }
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
