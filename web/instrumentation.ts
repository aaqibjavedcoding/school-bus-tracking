/**
 * Next.js instrumentation hook.
 *
 * Runs once per server process, inside Next's own module graph — which is
 * exactly why the Socket.IO gateway wiring lives here rather than in
 * `server.js`.
 *
 * The gateways attach broadcaster callbacks to `LiveTrackingService`,
 * `NotificationsService` and `EmergenciesService`. Those must be the very same
 * service instances the route handlers use, otherwise a REST call that
 * triggers a broadcast would notify nobody. `server.js` is a separate CommonJS
 * entry point with its own module registry, so wiring there would build a
 * second copy of the whole container. Wiring here guarantees one graph.
 *
 * The custom server publishes the io server on `globalThis`; when it is absent
 * (for example during `next build`, or under `next dev` without the custom
 * server) realtime is simply not wired and the HTTP API is unaffected.
 */
export async function register(): Promise<void> {
  // Only the Node.js runtime can host Sequelize/Socket.IO; the edge runtime
  // compiles this file too, so it must bail out there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { getIoServer, wireRealtimeGateways } = await import('./src/server/realtime');
  const { Logger } = await import('./src/server/framework');
  const logger = new Logger('Instrumentation');

  const io = getIoServer();
  if (!io) {
    logger.log('No Socket.IO server present; skipping realtime gateway wiring.');
    return;
  }

  wireRealtimeGateways(io);
}
