/**
 * App Router entry point for `/api/v1/document-requirements`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../server/http/route-runtime';
import { getDocumentrequirements, putDocumentrequirements } from '../../../../server/api/documents';

export const GET = createRouteHandler(getDocumentrequirements);
export const PUT = createRouteHandler(putDocumentrequirements);
