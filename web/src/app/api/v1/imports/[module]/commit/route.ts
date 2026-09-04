/**
 * App Router entry point for `/api/v1/imports/:module/commit`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { postImportsByModuleCommit } from '../../../../../../server/api/data-transfer-import';

export const POST = createRouteHandler(postImportsByModuleCommit);
