/**
 * App Router entry point for `/api/v1/notifications/devices/:token`.
 *
 * The behaviour lives in the endpoint definitions; `createRouteHandler` runs
 * the shared guard chain, validation and response envelope around them.
 */
import { createRouteHandler } from '../../../../../../server/http/route-runtime';
import { deleteNotificationsDevicesByToken } from '../../../../../../server/api/notifications';

export const DELETE = createRouteHandler(deleteNotificationsDevicesByToken);
