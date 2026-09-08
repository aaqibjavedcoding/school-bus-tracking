/**
 * Session-scoped cleanup registry for realtime socket connections.
 *
 * Why this exists (bundle + teardown correctness):
 *
 * The AuthProvider used to import the three socket services
 * (`live-tracking-socket`, `notifications-socket`, `emergencies-socket`)
 * directly so it could disconnect them on logout/unauthorized. Each of those
 * modules statically imports `socket.io-client`, so **every page** — the
 * login screen, the dashboard, the students list — paid for the realtime
 * client in the shared JS chunk even though only a handful of screens ever
 * open a socket.
 *
 * The registry inverts the dependency: a socket module registers its own
 * disconnect function here when the module is first loaded, and the
 * AuthProvider only ever imports this tiny file (zero dependencies). Pages
 * that never load a socket module never pull in `socket.io-client`; pages
 * that do (tracking, parent portal, emergencies, crew) register their
 * cleanup at import time, so session teardown stays exactly as synchronous
 * and complete as before: every open connection is closed, its listeners
 * removed and its module singleton reset the moment the session ends.
 */

type SocketCleanup = () => void;

const cleanups = new Set<SocketCleanup>();

/** Registers a disconnect routine (called once per module at import time). */
export function registerSocketCleanup(cleanup: SocketCleanup): void {
  cleanups.add(cleanup);
}

/**
 * Disconnects every registered realtime socket.
 *
 * Synchronous and idempotent: safe to call from logout and from the
 * unauthorized handler on every request that ends the session.
 */
export function disconnectAllSessionSockets(): void {
  for (const cleanup of cleanups) {
    cleanup();
  }
}
