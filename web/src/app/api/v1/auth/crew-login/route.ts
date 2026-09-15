/**
 * App Router entry point for `/api/v1/auth/crew-login`.
 *
 * Crew PIN / QR login (Mobile-UX Phase 4). The behaviour lives in the endpoint
 * definition; `createRouteHandler` runs the shared guard chain (CSRF → rate
 * limit → validation) and the response envelope around it.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { postAuthCrewLogin } from '../../../../../server/api/auth';

export const POST = createRouteHandler(postAuthCrewLogin);
