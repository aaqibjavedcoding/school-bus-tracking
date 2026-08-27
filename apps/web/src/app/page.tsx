import React from 'react';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { colors } from '@school-bus-tracking/design-tokens';
import { APP_CONFIG } from '@school-bus-tracking/config';

export default function HomePage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Hero Section */}
      <section
        style={{
          background: `linear-gradient(135deg, ${colors.neutral[900]} 0%, #1e293b 100%)`,
          color: '#ffffff',
          borderRadius: '12px',
          padding: '2.5rem 2rem',
          borderLeft: `6px solid ${colors.primary[500]}`,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}
        >
          <StatusBadge status="operational" label="Phase 1 Foundation Active" />
          <span style={{ fontSize: '0.85rem', color: colors.neutral[400] }}>
            v{APP_CONFIG.version}
          </span>
        </div>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '0.75rem' }}>
          Production Monorepo Foundation
        </h2>
        <p
          style={{
            fontSize: '1.05rem',
            color: colors.neutral[300],
            maxWidth: '750px',
            lineHeight: 1.6,
          }}
        >
          The production-grade monorepo foundation for the multi-tenant School Bus Tracking SaaS
          platform is operational. Built with Next.js App Router, NestJS API, Expo React Native, and
          PostgreSQL with Sequelize.
        </p>
      </section>

      {/* Services Grid */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
        }}
      >
        <Card
          title="Web Application"
          description="Next.js 14 App Router client application with TypeScript, shared design tokens, and modular feature architecture."
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1rem',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: colors.neutral[500] }}>apps/web</span>
            <StatusBadge status="operational" label="Ready" />
          </div>
        </Card>

        <Card
          title="API Gateway & Backend"
          description="NestJS micro-framework backend with modular architecture, common guards, interceptors, filters, and PostgreSQL Sequelize ORM."
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1rem',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: colors.neutral[500] }}>
              apps/api (Port 3001)
            </span>
            <StatusBadge status="operational" label="Ready" />
          </div>
        </Card>

        <Card
          title="Mobile Cross-Platform"
          description="Expo React Native mobile application supporting driver, conductor, and parent personas via expo-router."
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1rem',
            }}
          >
            <span style={{ fontSize: '0.85rem', color: colors.neutral[500] }}>apps/mobile</span>
            <StatusBadge status="operational" label="Ready" />
          </div>
        </Card>
      </section>

      {/* Shared Packages Grid */}
      <section>
        <h3
          style={{
            fontSize: '1.3rem',
            fontWeight: 700,
            marginBottom: '1rem',
            color: colors.neutral[800],
          }}
        >
          Shared Monorepo Packages
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          {[
            {
              name: '@school-bus-tracking/shared-types',
              desc: 'Domain models & API contract types',
            },
            {
              name: '@school-bus-tracking/design-tokens',
              desc: 'Cross-platform theme & style tokens',
            },
            { name: '@school-bus-tracking/config', desc: 'Shared environment & system constants' },
            { name: '@school-bus-tracking/validation', desc: 'Zod validation schemas' },
            { name: '@school-bus-tracking/api-client', desc: 'Type-safe HTTP API client' },
          ].map((pkg) => (
            <div
              key={pkg.name}
              style={{
                backgroundColor: '#ffffff',
                border: `1px solid ${colors.neutral[200]}`,
                borderRadius: '8px',
                padding: '1rem',
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  color: colors.neutral[900],
                  marginBottom: '0.35rem',
                }}
              >
                {pkg.name}
              </div>
              <div style={{ fontSize: '0.8rem', color: colors.neutral[500] }}>{pkg.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
