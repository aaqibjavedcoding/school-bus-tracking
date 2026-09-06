/**
 * App Router entry point for `/api/v1/run-crew/:id`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import {
  deleteRunCrewById,
  getRunCrewById,
  patchRunCrewById,
} from '../../../../../server/api/run-crew';

export const GET = createRouteHandler(getRunCrewById);
export const PATCH = createRouteHandler(patchRunCrewById);
export const DELETE = createRouteHandler(deleteRunCrewById);
