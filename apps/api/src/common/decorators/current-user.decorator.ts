import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * CurrentUser decorator placeholder (Phase 1)
 * Extracts authenticated user context from request object (activated in Phase 2).
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
