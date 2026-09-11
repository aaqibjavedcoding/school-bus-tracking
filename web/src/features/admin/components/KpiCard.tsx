'use client';

import Link from 'next/link';
import React from 'react';
import type { Tone } from '../metrics';

/**
 * Console KPI tile.
 *
 * One consistent shape for every headline number in the app — the Super Admin
 * console (`/admin`, `/admin/subscriptions`) and the school operations
 * dashboard both build their stat cards out of this component, so tone
 * accents, typography, spacing and hover/focus feedback can never drift apart.
 * Rendering the tile as a definition-style block (label above value) keeps
 * screen-reader output meaningful without extra ARIA.
 *
 * Three interaction modes, in that order of precedence:
 * - `href`     → the whole tile is a link to the corresponding list page.
 * - `onSelect` → the whole tile is a filter toggle (`aria-pressed`), used by
 *                the subscriptions console where a count applies a filter to
 *                the list on the *same* page instead of navigating away.
 * - neither    → a plain, non-interactive tile.
 *
 * Hover/focus/cursor feedback for the interactive modes comes from the
 * `.kpi-card--link` / `.kpi-card--button` rules in globals.css; `selected`
 * renders the persistent "this count is the filter in force" state.
 */
export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  /** Small caption rendered under the value, e.g. "Estimated". */
  caption?: string;
  /** When set, the entire tile becomes a link to the corresponding list page. */
  href?: string;
  /** Optional leading glyph, rendered in a tone-tinted chip beside the label. */
  icon?: React.ReactNode;
  /** When set, the entire tile becomes a button that applies this tile's filter. */
  onSelect?: () => void;
  /** Whether the filter this tile represents is currently applied. */
  selected?: boolean;
  /** Tooltip / accessible hint for the interactive modes, e.g. "Filter by active". */
  title?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  hint,
  tone,
  caption,
  href,
  icon,
  onSelect,
  selected = false,
  title,
}) => {
  const className = [
    'kpi-card',
    tone ? `kpi-card--${tone}` : '',
    href ? 'kpi-card--link' : '',
    onSelect ? 'kpi-card--button' : '',
    onSelect && selected ? 'kpi-card--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="kpi-card__label">
        {icon ? (
          <span className="kpi-card__icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      <span className="kpi-card__value">{value}</span>
      {caption ? <span className="kpi-card__caption">{caption}</span> : null}
      {hint ? <span className="kpi-card__hint muted">{hint}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link className={className} href={href} title={title}>
        {content}
      </Link>
    );
  }

  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={onSelect}
        aria-pressed={selected}
        title={title}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
};

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
