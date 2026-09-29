import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import {
  INITIAL_SCROLL_LOCK,
  isScrollLocked,
  reduceScrollLock,
  type ScrollLockEvent,
} from './scroll-lock.ts';

/**
 * The React half of the gesture-ownership rule (`scroll-lock.ts`).
 *
 * `<GestureIsland>` wraps a child that owns its own gestures — today the
 * driver's map card — and disables the surrounding `<Screen>`'s scrolling for
 * as long as a finger is inside it. The rest of the screen scrolls exactly as
 * before; a drag that *starts* on the map stays with the map.
 *
 * ### Why touch handlers rather than the responder system
 *
 * `onStartShouldSetResponder` and friends would make this `View` the JS
 * responder, which would take the touches **away from the native map** — the
 * map would then receive nothing at all. `onTouchStart` / `onTouchEnd` /
 * `onTouchCancel` are pure observers: React Native's touch dispatcher reports
 * them alongside the native view's own handling, so the map keeps every event
 * and we merely learn that a gesture is in progress.
 *
 * ### Why this is needed on top of the native `dragPan` fix
 *
 * On Android the map does ask its parents to stop intercepting
 * (`requestDisallowInterceptTouchEvent`), but only once `dragPan` has been
 * sent and only from the first move event it consumes; iOS has no equivalent
 * at all, and there the `ScrollView` can still win a mostly-vertical drag.
 * Disabling the scroll for the duration of the touch is the one mechanism that
 * behaves identically on both platforms. Both halves are kept: the native flag
 * because it is the engine's own path, this because it is deterministic.
 *
 * Outside a `<Screen>` (no provider above it) the component is an ordinary
 * `View` — nothing to lock, nothing to break.
 */

export interface ScrollLockContextValue {
  /** True while an island owns the gesture. */
  locked: boolean;
  lock: (owner: string) => void;
  release: (owner: string) => void;
}

const ScrollLockContext = React.createContext<ScrollLockContextValue | null>(null);

/** Owns the lock state for one scrolling screen. Used by `<Screen>`. */
export function useScrollLockOwner(): {
  locked: boolean;
  context: ScrollLockContextValue;
} {
  const [state, setState] = useState(INITIAL_SCROLL_LOCK);
  const dispatch = useCallback((event: ScrollLockEvent) => {
    setState((previous) => reduceScrollLock(previous, event));
  }, []);

  // A screen that unmounts mid-gesture never sees the touch end.
  useEffect(() => () => dispatch({ type: 'release-all' }), [dispatch]);

  const locked = isScrollLocked(state);
  const context = useMemo<ScrollLockContextValue>(
    () => ({
      locked,
      lock: (owner: string) => dispatch({ type: 'lock', owner }),
      release: (owner: string) => dispatch({ type: 'release', owner }),
    }),
    [locked, dispatch],
  );
  return { locked, context };
}

export const ScrollLockProvider: React.FC<{
  value: ScrollLockContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <ScrollLockContext.Provider value={value}>{children}</ScrollLockContext.Provider>
);

export const GestureIsland: React.FC<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Off for a surface that is not currently interactive (e.g. a placeholder). */
  enabled?: boolean;
}> = ({ children, style, enabled = true }) => {
  const context = React.useContext(ScrollLockContext);
  // One stable id per mounted island, so two maps on one screen cannot
  // release each other's lock.
  const owner = useId();
  const heldRef = useRef(false);

  const release = useCallback(() => {
    if (!heldRef.current) return;
    heldRef.current = false;
    context?.release(owner);
  }, [context, owner]);

  const take = useCallback(() => {
    if (!enabled || heldRef.current) return;
    heldRef.current = true;
    context?.lock(owner);
  }, [context, owner, enabled]);

  // Unmounting mid-gesture (a fullscreen switch, a trip change) must not leave
  // the screen unscrollable.
  useEffect(() => release, [release]);
  useEffect(() => {
    if (!enabled) release();
  }, [enabled, release]);

  return (
    <View style={style} onTouchStart={take} onTouchEnd={release} onTouchCancel={release}>
      {children}
    </View>
  );
};
