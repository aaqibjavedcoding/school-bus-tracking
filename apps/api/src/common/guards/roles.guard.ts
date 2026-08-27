import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequestUser } from './jwt-auth.guard';

/** Generic message when the authenticated user's role is not permitted. */
export const INSUFFICIENT_ROLE_MESSAGE = 'Insufficient role permissions';

/** Minimal shape of the incoming request the guard interacts with. */
interface RequestWithUser {
  user?: AuthenticatedRequestUser;
}

/**
 * Role-based authorization guard (activated in Phase 2).
 *
 * Reads the roles declared via `@Roles(...)` (handler-level metadata wins
 * over controller-level) and denies access with `403` unless the
 * authenticated user — attached by `JwtAuthGuard` — holds one of them.
 *
 * Endpoints without any `@Roles(...)` metadata only require authentication,
 * so this guard composes safely with `JwtAuthGuard`:
 *
 * ```ts
 * @UseGuards(JwtAuthGuard, RolesGuard) // order matters: authenticate, then authorize
 * @Roles(UserRole.SCHOOL_ADMIN)
 * ```
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() metadata — the endpoint is authenticated, not role-restricted.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request?.user;

    // Defense in depth: without an authenticated user there is no role to
    // check, so a role-restricted route can never be reached anonymously.
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(INSUFFICIENT_ROLE_MESSAGE);
    }

    return true;
  }
}
