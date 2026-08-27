import type { Metadata } from 'next';
import './globals.css';
import { Header } from '../components/Header';

export const metadata: Metadata = {
  title: 'School Bus Tracking SaaS',
  description: 'Production-grade, multi-tenant School Bus Tracking platform foundation',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header title="School Bus Tracking Platform" subtitle="Enterprise Multi-Tenant SaaS" />
        <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem 1rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
