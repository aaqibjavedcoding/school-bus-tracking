/**
 * Socket.IO namespace wiring — the replacement for Nest's `@WebSocketGateway`
 * discovery.
 *
 * Nest used to instantiate each gateway, hand it its namespace as `server`,
 * call `afterInit()`, and subscribe `handleConnection` / `handleDisconnect` /
 * every `@SubscribeMessage` handler. All of that is done explicitly here.
 *
 * CRITICAL — shared singletons. The gateways attach broadcasters to
 * `LiveTrackingService`, `NotificationsService` and `EmergenciesService`. If
 * this wiring ran against a different instance of those services than the
 * HTTP route handlers use, every realtime broadcast triggered by a REST call
 * would silently go nowhere. That is why the gateways are built from the same
 * process-wide {@link getContainer} the route handlers use, and why this
 * function is invoked from Next's `instrumentation.ts` (same module graph as
 * the route handlers) rather than from the custom server bundle.
 */
import type { Server, Socket } from 'socket.io';
import {
  EMERGENCIES_NAMESPACE,
  LIVE_TRACKING_EVENTS,
  LIVE_TRACKING_NAMESPACE,
  NOTIFICATIONS_NAMESPACE,
} from '@school-bus-tracking/shared-types';
import { Logger } from '../framework';
import { getContainer } from '../container';
import { LiveTrackingGateway } from '../modules/live-tracking/live-tracking.gateway';
import { NotificationsGateway } from '../modules/notifications/notifications.gateway';
import { EmergenciesGateway } from '../modules/emergencies/emergencies.gateway';

/**
 * Runs an async connection handler without letting a rejection escape.
 *
 * Nest awaited `handleConnection` inside its own gateway adapter and logged
 * anything that threw. Here the Socket.IO `connection` listener is
 * synchronous, so an unhandled rejection (for example the school lookup
 * failing) would otherwise reach `process.on('unhandledRejection')` and, on
 * newer Node versions, take the server down. The socket is disconnected
 * instead — the same outcome as a failed handshake.
 */
function runConnection(
  socket: Socket,
  handler: (client: Socket) => Promise<void> | void,
  logger: Logger,
): void {
  void Promise.resolve()
    .then(() => handler(socket))
    .catch((error: unknown) => {
      logger.error(
        `Socket connection handler failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      socket.disconnect(true);
    });
}

/** Guard so repeated instrumentation runs (dev hot-reload) wire only once. */
const WIRED_KEY = Symbol.for('school-bus-tracking.realtime-wired');
type GlobalWithFlag = typeof globalThis & { [WIRED_KEY]?: boolean };

/**
 * A Nest `@SubscribeMessage({ cmd, ack: true })` handler resolves its return
 * value into the client's acknowledgement callback. This reproduces that
 * contract, including the "no ack callback supplied" case.
 */
function bindAckHandler(
  socket: Socket,
  event: string,
  handler: (client: Socket, payload: unknown) => Promise<unknown> | unknown,
  logger: Logger,
): void {
  socket.on(event, async (payload: unknown, ack?: (response: unknown) => void) => {
    try {
      const result = await handler(socket, payload);
      if (typeof ack === 'function') {
        ack(result);
      }
    } catch (error) {
      logger.error(
        `Socket handler "${event}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (typeof ack === 'function') {
        ack({ status: 'rejected', reason: 'internal_error' });
      }
    }
  });
}

/**
 * Attaches all three gateways to their namespaces on the given io server.
 *
 * Idempotent — safe to call again after a dev hot-reload.
 */
export function wireRealtimeGateways(io: Server): void {
  const globalRef = globalThis as GlobalWithFlag;
  if (globalRef[WIRED_KEY]) {
    return;
  }
  globalRef[WIRED_KEY] = true;

  const logger = new Logger('Realtime');
  const c = getContainer();

  // ------------------------------------------------------- live tracking
  const liveTracking = new LiveTrackingGateway(
    c.liveTracking(),
    c.stopArrivals(),
    c.jwt(),
    c.schoolAccess(),
  );
  const liveNamespace = io.of(LIVE_TRACKING_NAMESPACE);
  liveTracking.server = liveNamespace as unknown as Server;
  liveTracking.afterInit();
  liveNamespace.on('connection', (socket: Socket) => {
    runConnection(socket, (client) => liveTracking.handleConnection(client), logger);
    bindAckHandler(
      socket,
      LIVE_TRACKING_EVENTS.join,
      (client, payload) => liveTracking.handleJoin(client, payload),
      logger,
    );
    bindAckHandler(
      socket,
      LIVE_TRACKING_EVENTS.leave,
      (client, payload) => liveTracking.handleLeave(client, payload),
      logger,
    );
    bindAckHandler(
      socket,
      LIVE_TRACKING_EVENTS.locationUpdate,
      (client, payload) => liveTracking.handleLocationUpdate(client, payload),
      logger,
    );
    socket.on('disconnect', () => liveTracking.handleDisconnect(socket));
  });

  // -------------------------------------------------------- notifications
  const notifications = new NotificationsGateway(c.notifications(), c.jwt(), c.schoolAccess());
  const notificationsNamespace = io.of(NOTIFICATIONS_NAMESPACE);
  notifications.server = notificationsNamespace as unknown as Server;
  notifications.afterInit();
  notificationsNamespace.on('connection', (socket: Socket) => {
    runConnection(socket, (client) => notifications.handleConnection(client), logger);
    socket.on('disconnect', () => notifications.handleDisconnect(socket));
  });

  // ---------------------------------------------------------- emergencies
  const emergencies = new EmergenciesGateway(c.emergencies(), c.jwt(), c.schoolAccess());
  const emergenciesNamespace = io.of(EMERGENCIES_NAMESPACE);
  emergencies.server = emergenciesNamespace as unknown as Server;
  emergencies.afterInit();
  emergenciesNamespace.on('connection', (socket: Socket) => {
    runConnection(socket, (client) => emergencies.handleConnection(client), logger);
    socket.on('disconnect', () => emergencies.handleDisconnect(socket));
  });

  logger.log(
    `Socket.IO namespaces ready: ${LIVE_TRACKING_NAMESPACE}, ${NOTIFICATIONS_NAMESPACE}, ${EMERGENCIES_NAMESPACE}`,
  );
}

/**
 * Reads the io server the custom server (`server.js`) published on
 * `globalThis`. Returns null when running without a custom server (for
 * example `next build`), in which case realtime is simply not wired.
 */
export function getIoServer(): Server | null {
  const globalRef = globalThis as typeof globalThis & { __socketIoServer?: Server };
  return globalRef.__socketIoServer ?? null;
}
