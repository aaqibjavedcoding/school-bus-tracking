/**
 * App Router entry point for `/api/v1/account/me/photo`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 * `GET` is the read-back convenience (the account's own bytes, no key in the
 * URL); the key-addressed route for *another* account's photo — the parent
 * app's crew avatar — is `/api/v1/crew-photos/{key…}`.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import {
  getAccountMePhoto,
  putAccountMePhoto,
  deleteAccountMePhoto,
} from '../../../../../../server/api/account';

export const GET = createRouteHandler(getAccountMePhoto);
export const PUT = createRouteHandler(putAccountMePhoto);
export const DELETE = createRouteHandler(deleteAccountMePhoto);
