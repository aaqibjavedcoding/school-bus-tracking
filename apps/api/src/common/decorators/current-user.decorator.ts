import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../guards/jwt-auth.guard';

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
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedRequestUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedRequestUser }>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
