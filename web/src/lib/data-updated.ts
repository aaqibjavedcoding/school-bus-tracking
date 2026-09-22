/**
 * "Something changed" — the one signal every list screen listens to.
 *
 * ### The bug this closes
 *
 * Each page refreshed the list it owned: after saving a bus, `/buses` called
 * `list.reload()`. Nothing else moved. The route detail page's bus picker, the
 * dashboard's counts, the compliance overview and the *other* section of a
 * screen that shows two lists (`/admin/schools/:id` renders admins and a
 * subscription) all kept the rows from before the write, so an operator had to
 * press the browser's reload button to see their own save.
 *
 * ### The rule
 *
 * A successful mutation invalidates the app's view of the world. One event is
 * broadcast, every mounted list refetches, and the response cache is already
 * clear by the time they ask (see `services/api.ts`). A *failed* mutation
 * broadcasts nothing: a rejected save changed no rows, and refetching on every
 * 400 would turn a typo into a stampede.
 *
 * ### Why a local event and not the socket
 *
 * The realtime namespaces carry trip positions, notifications and emergencies
 * (`LIVE_TRACKING_EVENTS`, `NOTIFICATION_EVENTS`, `EMERGENCY_EVENTS`). There is
 * no `bus:updated` event to subscribe to — the API does not broadcast CRUD — so
 * the honest mechanism for "my own write is visible everywhere" is a refetch.
 * Other people's writes still arrive over the socket on the screens that join a
 * room; this bus only covers what the socket cannot: this browser's own change.
 *
 * The subscriber is debounced so a screen that fires two writes in a row (link
 * a parent, then assign the guardian) reloads once.
 *
 * Pure and dependency-free, like every other module under `lib/`, so
 * `node --test` can pin the contract.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Notifies every mounted list that data changed. */
export function notifyDataUpdated(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribes to invalidations; returns the unsubscribe function. */
export function subscribeDataUpdated(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: drop every subscriber. */
export function __resetDataUpdatedListenersForTests(): void {
  listeners.clear();
}

/**
 * The quiet window a reload is coalesced into.
 *
 * Long enough to swallow the burst from a multi-step save (create then link),
 * short enough that the row a user just typed is on screen before they look for
 * it.
 */
export const DATA_UPDATED_DEBOUNCE_MS = 120;

/**
 * Wraps a `reload` in that window: the first invalidation starts a timer, any
 * further invalidation inside it is ignored, and the timer fires once.
 *
 * Returns a cancel function so a hook can guarantee no reload lands after
 * unmount — refetching into an unmounted component is the classic
 * "setState on unmounted" warning this repo keeps out of the console.
 */
export function createDebouncedReload(
  reload: () => Promise<unknown> | void,
  delayMs: number = DATA_UPDATED_DEBOUNCE_MS,
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (handle: ReturnType<typeof setTimeout>) => void = clearTimeout,
): { request: () => void; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const request = (): void => {
    if (handle !== null) return;
    handle = schedule(() => {
      handle = null;
      void reload();
    }, delayMs);
  };
  return {
    request,
    cancel: () => {
      if (handle !== null) cancel(handle);
      handle = null;
    },
  };
}
