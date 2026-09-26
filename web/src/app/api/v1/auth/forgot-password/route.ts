/**
 * App Router entry point for `/api/v1/auth/forgot-password`.
 *
 * SCHOOL_ADMIN self-service password reset, step 1. The behaviour lives in
 * the endpoint definition; `createRouteHandler` runs the shared guard chain
 * (CSRF → rate limit → validation) and the response envelope around it.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { postAuthForgotPassword } from '../../../../../server/api/auth';

export const POST = createRouteHandler(postAuthForgotPassword);
