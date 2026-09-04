/**
 * App Router entry point for `/api/v1/trips/:tripId/students/:studentId/board`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../../../server/http/route-runtime';
import { postTripsByTripIdStudentsByStudentIdBoard } from '../../../../../../../../server/api/trip-attendance';

export const POST = createRouteHandler(postTripsByTripIdStudentsByStudentIdBoard);
