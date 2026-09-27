/**
 * App Router entry point for `/api/v1/account/me/photo`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { putAccountMePhoto, deleteAccountMePhoto } from '../../../../../../server/api/account';

export const PUT = createRouteHandler(putAccountMePhoto);
export const DELETE = createRouteHandler(deleteAccountMePhoto);
