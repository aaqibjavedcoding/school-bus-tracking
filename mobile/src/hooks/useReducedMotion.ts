import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * The OS "reduce motion" preference, live.
 *
 * Uses React Native's built-in `AccessibilityInfo` — no new dependency, which
 * matters here because `docs/mobile-expo-sdk.md` requires every Expo SDK 57
 * dependency to be an exact published version, and this needs none.
 *
 * The listener matters as much as the initial read: a user can flip the switch
 * in system settings while the app is open, and a tracking map that keeps
 * animating after that is ignoring an accessibility request rather than
 * honouring it.
 *
 * Defaults to `false` and stays there if the platform cannot answer (the query
 * is a promise that can reject), which is the safe direction: motion is the
 * existing behaviour, and a failed probe must not silently disable it.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {
        // An unreadable preference is not an error worth surfacing on a
        // tracking screen; keep the default.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      setReduced(value);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
