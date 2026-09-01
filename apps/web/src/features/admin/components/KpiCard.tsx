'use client';

import React from 'react';
import type { Tone } from '../metrics';

/**
 * Console KPI tile.
 *
 * One consistent shape for every headline number in the Super Admin console:
 * label, value, optional hint and an optional tone accent. Rendering the tile
 * as a definition-style block (label above value) keeps screen-reader output
 * meaningful without extra ARIA.
 */
export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  /** Small caption rendered under the value, e.g. "Estimated". */
  caption?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint, tone, caption }) => (
  <div className={`kpi-card${tone ? ` kpi-card--${tone}` : ''}`}>
    <span className="kpi-card__label">{label}</span>
    <span className="kpi-card__value">{value}</span>
    {caption ? <span className="kpi-card__caption">{caption}</span> : null}
    {hint ? <span className="kpi-card__hint muted">{hint}</span> : null}
  </div>
);

/** Responsive KPI grid: 4 → 2 → 1 columns as the viewport narrows. */
export const KpiGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`kpi-grid ${className}`.trim()}>{children}</div>;

/** Skeleton placeholder that keeps the KPI grid's layout while loading. */
export const KpiGridSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="kpi-grid" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <div className="kpi-card" key={index}>
        <span className="skeleton skeleton-line" style={{ width: '55%', height: 10 }} />
        <span className="skeleton skeleton-line" style={{ width: '40%', height: 24 }} />
      </div>
    ))}
  </div>
);
