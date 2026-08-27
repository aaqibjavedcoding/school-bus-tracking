import React from 'react';
import { colors } from '@school-bus-tracking/design-tokens';

export interface CardProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, description, children }) => {
  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '10px',
        border: `1px solid ${colors.neutral[200]}`,
        padding: '1.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      <h3
        style={{
          marginTop: 0,
          marginBottom: '0.5rem',
          fontSize: '1.1rem',
          fontWeight: 600,
          color: colors.neutral[900],
        }}
      >
        {title}
      </h3>
      {description && (
        <p
          style={{
            margin: '0 0 1rem 0',
            fontSize: '0.9rem',
            color: colors.neutral[600],
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}
      {children}
    </div>
  );
};
