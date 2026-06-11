import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WorkerChat CRM',
  description: 'Privacy-first, channel-agnostic CRM for independent service providers.',
  robots: { index: false, follow: false }, // never index the app
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
