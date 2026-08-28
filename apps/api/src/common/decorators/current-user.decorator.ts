import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import type { AuthenticatedRequestUser } from '../guards/jwt-auth.guard';

/**
 * Property map for {@link CurrentUser}.
 *
 * `school_id` is narrowed to `string` for school-scoped callers: the JWT
 * payload contract guarantees it is a non-empty UUID for every role except
 * `SUPER_ADMIN` (whose token carries `school_id: null`), and tenant-scoped
 * controllers additionally gate on `@Roles(...)` so a platform admin can
 * never reach them. Controllers on the `/admin/*` surface read the managed
 * tenant id from the route instead and do not use this claim.
 */
interface CurrentUserPropertyMap {
  id: string;
  school_id: string;
  role: UserRole;
}

/**
 * Parameter decorator providing the authenticated user attached to the
 * request by `JwtAuthGuard` (Phase 2).
 *
 * Returns the non-sensitive user context (token claims only):
 *
 * ```ts
 * @Get('me')
 * @UseGuards(JwtAuthGuard)
 * getMe(@CurrentUser() user: AuthenticatedRequestUser) { ... }
 * ```
 *
 * A single property can also be requested: `@CurrentUser('id')`.
 */
export const CurrentUser = createParamDecorator<keyof CurrentUserPropertyMap | undefined>(
  (data: keyof CurrentUserPropertyMap | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedRequestUser }>();
    const user = request.user;
    if (data && user) {
      return user[data] as CurrentUserPropertyMap[typeof data];
    }
    return user;
  },
);
