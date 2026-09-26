/**
 * App Router entry point for `/api/v1/auth/reset-password`.
 *
 * SCHOOL_ADMIN self-service password reset, step 2 — the emailed token is
 * the credential, so the route is unauthenticated. The behaviour lives in the
 * endpoint definition; `createRouteHandler` runs the shared guard chain
 * (CSRF → rate limit → validation) and the response envelope around it.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { postAuthResetPassword } from '../../../../../server/api/auth';

export const POST = createRouteHandler(postAuthResetPassword);
