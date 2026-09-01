'use client';

import React from 'react';
import type { BarRow, Slice, Tone, UsageRow } from '../metrics';

/**
 * Dependency-free data visualisation for the Super Admin console.
 *
 * The project ships no charting library and does not need one: every chart
 * used by the platform console is a distribution over a handful of buckets,
 * which renders perfectly as inline SVG / CSS bars. Keeping it in-repo avoids
 * adding a large client bundle for four charts, and every chart carries a
 * text alternative (legend rows with the exact numbers) so the information is
 * never conveyed by colour alone.
 */

const TONE_COLOR: Record<Tone, string> = {
  neutral: '#94a3b8',
  info: '#3b82f6',
  success: '#16a34a',
  warning: '#f59e0b',
  danger: '#dc2626',
};

export function toneColor(tone: Tone | undefined): string {
  return TONE_COLOR[tone ?? 'neutral'];
}

/** Donut chart + legend. Renders an empty state when everything is zero. */
export const DonutChart: React.FC<{
  slices: Slice[];
  /** Rendered inside the ring, e.g. the total. */
  centerValue?: string | number;
  centerLabel?: string;
  emptyLabel?: string;
  size?: number;
}> = ({ slices, centerValue, centerLabel, emptyLabel = 'No data yet', size = 168 }) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyLabel}
      </p>
    );
  }

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="chart-donut">
      <svg
        width={size}
        height={size}
        viewBox="0 0 140 140"
        role="img"
        aria-label={slices.map((slice) => `${slice.label}: ${slice.value}`).join(', ')}
      >
        <g transform="rotate(-90 70 70)">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="#eef2f7" strokeWidth="18" />
          {slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={slice.key}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={toneColor(slice.tone)}
                strokeWidth="18"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return element;
          })}
        </g>
        {centerValue !== undefined ? (
          <text x="70" y="68" textAnchor="middle" className="chart-donut__value">
            {centerValue}
          </text>
        ) : null}
        {centerLabel ? (
          <text x="70" y="86" textAnchor="middle" className="chart-donut__label">
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="chart-legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span className="chart-legend__dot" style={{ background: toneColor(slice.tone) }} />
            <span className="chart-legend__label">{slice.label}</span>
            <span className="chart-legend__value">
              {slice.value}
              <span className="muted"> ({Math.round((slice.value / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Horizontal bar list — the readable alternative to a pie for many buckets. */
export const BarList: React.FC<{ rows: BarRow[]; emptyLabel?: string }> = ({
  rows,
  emptyLabel = 'No data yet',
}) => {
  const max = rows.reduce((highest, row) => Math.max(highest, row.value), 0);
  if (rows.length === 0 || max <= 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="chart-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="chart-bars__head">
            <span>
              {row.label}
              {row.hint ? <span className="muted"> · {row.hint}</span> : null}
            </span>
            <strong>{row.display ?? row.value}</strong>
          </div>
          <div
            className="chart-bars__track"
            role="meter"
            aria-valuenow={row.value}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-label={row.label}
          >
            <span
              className="chart-bars__fill"
              style={{
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                background: toneColor(row.tone ?? 'info'),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};

/** Usage-vs-limit meter, e.g. "Students 82 / 100". */
export const UsageMeter: React.FC<{ row: UsageRow }> = ({ row }) => (
  <div className="usage-meter">
    <div className="usage-meter__head">
      <span>{row.label}</span>
      <strong>{row.display}</strong>
    </div>
    <div
      className="usage-meter__track"
      role="meter"
      aria-valuenow={row.usage}
      aria-valuemin={0}
      aria-valuemax={row.limit ?? row.usage}
      aria-label={`${row.label}: ${row.display}`}
    >
      <span
        className="usage-meter__fill"
        style={{
          width: row.unlimited || row.limit === null ? '100%' : `${Math.max(2, row.percent)}%`,
          background: row.unlimited || row.limit === null ? '#e2e8f0' : toneColor(row.tone),
        }}
      />
    </div>
    <span className="usage-meter__foot muted">
      {row.unlimited
        ? 'Unlimited on this plan'
        : row.limit === null
          ? 'No limit configured on this plan'
          : `${row.percent}% of the plan limit used`}
    </span>
  </div>
);
