import React from 'react';
import { colors } from '@school-bus-tracking/design-tokens';

export interface HeaderProps {
  title: string;
  subtitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle }) => {
  return (
    <header
      style={{
        backgroundColor: colors.neutral[900],
        color: '#ffffff',
        padding: '1.25rem 2rem',
        borderBottom: `2px solid ${colors.primary[500]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            backgroundColor: colors.primary[500],
            color: colors.neutral[900],
            fontWeight: 800,
            fontSize: '1.25rem',
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
          }}
        >
          SBT
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>{title}</h1>
          {subtitle && (
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: colors.neutral[400],
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div
        style={{
          fontSize: '0.8rem',
          backgroundColor: 'rgba(245, 158, 11, 0.15)',
          color: colors.primary[400],
          padding: '0.35rem 0.75rem',
          borderRadius: '9999px',
          border: `1px solid ${colors.primary[500]}40`,
        }}
      >
        Phase 1 Foundation
      </div>
    </header>
  );
};
