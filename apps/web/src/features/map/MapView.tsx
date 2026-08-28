'use client';

import dynamic from 'next/dynamic';
import type { MapViewProps } from './types';

export const MapView = dynamic<MapViewProps>(
  () => import('./MapViewInner').then((mod) => ({ default: mod.MapViewInner })),
  {
    ssr: false,
    loading: () => (
      <div className="map-shell">
        <div className="empty">
          <p className="muted">Loading map…</p>
        </div>
      </div>
    ),
  },
);
