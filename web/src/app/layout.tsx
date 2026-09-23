import type { Metadata } from 'next';
import { APP_CONFIG } from '@school-bus-tracking/config';
import { Providers } from '../components/Providers';
import './globals.css';

export const metadata: Metadata = {
  // The browser tab / bookmark name. One brand source: `APP_CONFIG` in
  // `@school-bus-tracking/config`, which the login page and the AppShell
  // sidebar read too — so a future rename is a one-line change.
  title: APP_CONFIG.appName,
  description: 'Live school bus operations for admins, crew and parents',
  // The KidBus mark as the browser-tab icon (served from web/public).
  icons: { icon: '/favicon.png' },
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
