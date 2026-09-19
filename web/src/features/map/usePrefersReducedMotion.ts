'use client';

import { useEffect, useState } from 'react';

/**
 * The OS/browser "reduce motion" preference, live.
 *
 * Uses the platform `matchMedia` API — no dependency, and the same preference
 * the native map reads through React Native's `AccessibilityInfo`, so one
 * setting stops the bus animating on both surfaces.
 *
 * The listener matters as much as the initial read: the preference can change
 * while the page is open (and `matchMedia` is also how a user agent reports a
 * session-level override), and a map that keeps animating after that is
 * ignoring an accessibility request.
 *
 * Guards every access, because this module is imported by a `'use client'`
 * component that Next may still evaluate where `window` is absent.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    // `addEventListener` on MediaQueryList is the modern API; `addListener` is
    // the deprecated Safari fallback and is deliberately not used.
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
