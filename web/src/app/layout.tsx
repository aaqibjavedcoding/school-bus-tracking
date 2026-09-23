import type { Metadata } from 'next';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { Providers } from '../components/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: APP_CONFIG.appName,
  description: 'Live school bus operations for admins, crew and parents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
