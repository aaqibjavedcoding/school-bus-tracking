/**
 * App Router entry point for `/api/v1/notifications/devices`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../server/http/route-runtime';
import { postNotificationsDevices } from '../../../../../server/api/notifications';

export const POST = createRouteHandler(postNotificationsDevices);
