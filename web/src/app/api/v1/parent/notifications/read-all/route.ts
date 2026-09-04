/**
 * App Router entry point for `/api/v1/parent/notifications/read-all`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { patchParentNotificationsReadall } from '../../../../../../server/api/notifications';

export const PATCH = createRouteHandler(patchParentNotificationsReadall);
