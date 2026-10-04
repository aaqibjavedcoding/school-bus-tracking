'use client';

import { useEffect, useState } from 'react';
import type { MapColorScheme } from './style-variant.ts';

/**
 * The OS/browser colour scheme, live — the app's existing theme signal.
 *
 * Sibling of `usePrefersReducedMotion`: same platform `matchMedia`
 * primitive, no dependency, no new user setting. The map is currently its
 * only consumer (kidbus-day / kidbus-night selection in `style-variant.ts`);
 * the initial server-side/default value is 'light', which is what
 * `matchMedia`-less environments (and the pre-hydration render) get.
 *
 * The change listener matters for the same reason as in the reduced-motion
 * hook: the scheme can flip while the page is open (OS auto dark mode at
 * sunset), and a map that never follows is ignoring the signal.
 */
export function usePrefersColorScheme(): MapColorScheme {
  const [scheme, setScheme] = useState<MapColorScheme>('light');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setScheme(query.matches ? 'dark' : 'light');

    const onChange = (event: MediaQueryListEvent) => setScheme(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return scheme;
}
