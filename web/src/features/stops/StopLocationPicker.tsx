'use client';

import dynamic from 'next/dynamic';
import type { StopLocationPickerProps } from './StopLocationPickerInner';

/**
 * Client-only wrapper around the stop location map.
 *
 * MapLibre reads `window`/`navigator` at import time, so the picker is loaded
 * the same way the tracking map is (`features/map/MapView.tsx`): dynamically,
 * with `ssr: false`.
 */
export const StopLocationPicker = dynamic<StopLocationPickerProps>(
  () =>
    import('./StopLocationPickerInner').then((mod) => ({ default: mod.StopLocationPickerInner })),
  {
    ssr: false,
    loading: () => (
      <div className="stop-location-picker">
        <div className="stop-location-map stop-location-map-loading">
          <p className="muted">Loading map…</p>
        </div>
      </div>
    ),
  },
);

export type { StopLocationPickerProps };
