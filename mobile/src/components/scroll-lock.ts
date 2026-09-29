/**
 * Who owns a vertical drag when a **native map** lives inside a scrolling
 * screen — the pure half (React-free, node-testable).
 *
 * ### The problem this exists for
 *
 * The driver's trip screen is one `<Screen>` (a `ScrollView`) with the
 * DriverTripMap as one of its cards. A `ScrollView` and a native map want the
 * same gesture: a one-finger vertical drag. On Android the parent wins by
 * default — it intercepts the move stream from its children — so a driver
 * trying to pan the map scrolled the page instead, and a pinch that started
 * with a fractionally uneven finger-down was interrupted mid-gesture. That is
 * the classic "native map inside a ScrollView" ownership bug, and it is not
 * something the map's own props can fix on their own:
 * `@maplibre/maplibre-react-native` does call `requestDisallowInterceptTouchEvent(true)`
 * on Android, but only while its `dragPan` prop is on (see
 * `features/map/maplibre-runtime.spec.ts`), and nothing equivalent exists on
 * the JS side for the first few pixels of the gesture.
 *
 * ### The rule
 *
 * A component that owns its own gestures (a map card, a slider) declares
 * itself an *island*: while a touch is inside it, the surrounding scroll view
 * is disabled, and it is re-enabled when the touch ends. The screen keeps
 * scrolling everywhere else, always.
 *
 * The state is a **multiset of owners**, not a boolean, for the obvious
 * reason: two islands on one screen (or a remount mid-gesture) must not be
 * able to unlock each other. `release-all` exists for a screen teardown, where
 * no touch-end will ever arrive.
 *
 * Re-locking an owner that already holds the lock is a no-op on purpose — a
 * touch event stream can report several starts before an end, and counting
 * them would leak a lock the moment one end event is dropped.
 */

export interface ScrollLockState {
  /** Islands currently holding the lock, in the order they took it. */
  readonly owners: readonly string[];
}

export type ScrollLockEvent =
  /** A touch started inside the island. */
  | { type: 'lock'; owner: string }
  /** The touch ended, was cancelled, or the island unmounted. */
  | { type: 'release'; owner: string }
  /** The screen is going away: nothing may keep it locked. */
  | { type: 'release-all' };

export const INITIAL_SCROLL_LOCK: ScrollLockState = { owners: [] };

export function reduceScrollLock(
  state: ScrollLockState,
  event: ScrollLockEvent,
): ScrollLockState {
  switch (event.type) {
    case 'lock':
      if (state.owners.includes(event.owner)) return state;
      return { owners: [...state.owners, event.owner] };

    case 'release': {
      if (!state.owners.includes(event.owner)) return state;
      return { owners: state.owners.filter((owner) => owner !== event.owner) };
    }

    case 'release-all':
      return state.owners.length === 0 ? state : INITIAL_SCROLL_LOCK;
  }
}

/** True while at least one island owns the gesture. */
export function isScrollLocked(state: ScrollLockState): boolean {
  return state.owners.length > 0;
}
