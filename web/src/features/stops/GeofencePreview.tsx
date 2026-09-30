'use client';

import React from 'react';

/** The warning that sits under the radius input on every stop form. */
export const GEOFENCE_RADIUS_HELP = 'Smaller than ~20 m may never trigger on a phone';

/** Diameter of the preview square, in CSS pixels. */
const SIZE = 160;
/** Metres represented by half the preview square — the preview's "zoom". */
const HALF_SPAN_METERS = 120;

/**
 * A live, to-scale preview of the stop's geofence as the radius is typed.
 *
 * Deliberately NOT a tile map: this is a *scale* question ("is 25 m the kerb
 * or the whole junction?"), the answer only needs a metre grid, and drawing
 * it locally keeps the admin form free of the map engine, a tile provider
 * and a network round trip per keystroke. The grid squares are 20 m, the
 * dashed ring is the radius, and the solid dot is the surveyed coordinate —
 * the same visual language the driver's map uses.
 *
 * A radius larger than the preview span is clamped and labelled, so a typo of
 * 2000 still renders something honest instead of an invisible circle.
 */
export const GeofencePreview: React.FC<{ radiusMeters: number | null }> = ({ radiusMeters }) => {
  const valid = radiusMeters !== null && Number.isFinite(radiusMeters) && radiusMeters > 0;
  const metersPerPixel = HALF_SPAN_METERS / (SIZE / 2);
  const rawRadiusPx = valid ? (radiusMeters as number) / metersPerPixel : 0;
  const radiusPx = Math.min(rawRadiusPx, SIZE / 2 - 2);
  const clamped = rawRadiusPx > SIZE / 2 - 2;
  const center = SIZE / 2;
  const gridStepPx = 20 / metersPerPixel;

  return (
    <div className="geofence-preview">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={
          valid
            ? `Geofence preview: ${Math.round(radiusMeters as number)} metre radius, 20 metre grid`
            : 'Geofence preview: no radius set'
        }
      >
        <rect width={SIZE} height={SIZE} fill="#f8fafc" stroke="#e2e8f0" />
        {Array.from({ length: Math.floor(SIZE / gridStepPx) + 1 }, (_, index) => (
          <g key={index} stroke="#e2e8f0" strokeWidth={1}>
            <line x1={index * gridStepPx} y1={0} x2={index * gridStepPx} y2={SIZE} />
            <line x1={0} y1={index * gridStepPx} x2={SIZE} y2={index * gridStepPx} />
          </g>
        ))}
        {valid ? (
          <circle
            cx={center}
            cy={center}
            r={radiusPx}
            fill="none"
            stroke="rgb(180, 83, 9)"
            strokeWidth={1.5}
            strokeOpacity={0.75}
            strokeDasharray="4 4"
          />
        ) : null}
        <circle cx={center} cy={center} r={3.5} fill="rgb(180, 83, 9)" stroke="#ffffff" />
      </svg>
      <p className="muted geofence-preview-caption">
        {valid
          ? `${Math.round(radiusMeters as number)} m radius · grid squares are 20 m${
              clamped ? ' (ring clipped to fit)' : ''
            }`
          : 'Enter a radius to preview the zone'}
      </p>
    </div>
  );
};
