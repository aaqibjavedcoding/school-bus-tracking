import React from 'react';
import { colors } from '@school-bus-tracking/design-tokens';

export interface StatusBadgeProps {
  status: 'operational' | 'ready' | 'pending';
  label: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const getBadgeColors = () => {
    switch (status) {
      case 'operational':
        return {
          bg: '#dcfce7',
          text: colors.secondary[800],
          border: colors.secondary[300],
          dot: colors.secondary[600],
        };
      case 'ready':
        return {
          bg: '#e0f2fe',
          text: '#0369a1',
          border: '#7dd3fc',
          dot: '#0284c7',
        };
      case 'pending':
      default:
        return {
          bg: colors.neutral[100],
          text: colors.neutral[700],
          border: colors.neutral[300],
          dot: colors.neutral[500],
        };
    }
  };

  const currentColors = getBadgeColors();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.25rem 0.65rem',
        borderRadius: '9999px',
        fontSize: '0.8rem',
        fontWeight: 600,
        backgroundColor: currentColors.bg,
        color: currentColors.text,
        border: `1px solid ${currentColors.border}`,
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: currentColors.dot,
        }}
      />
      {label}
    </span>
  );
};
