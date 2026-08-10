import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'AtlasHub Admin',
    template: '%s | AtlasHub',
  },
  description:
    'Self-hosted backend platform with database-per-project architecture, S3-compatible storage, and real-time API management.',
  keywords: [
    'backend platform',
    'self-hosted',
    'database',
    'storage',
    'API',
    'admin dashboard',
    'PostgreSQL',
    'MinIO',
    'S3',
  ],
  authors: [{ name: 'AtlasHub' }],
  creator: 'AtlasHub',
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'AtlasHub Admin',
    title: 'AtlasHub Admin Dashboard',
    description:
      'Self-hosted backend platform with database-per-project architecture and S3-compatible storage.',
  },
  twitter: {
    card: 'summary',
    title: 'AtlasHub Admin',
    description: 'Self-hosted backend platform admin dashboard',
  },
  icons: {
    icon: [{ url: '/favicon.ico', type: 'image/x-icon' }],
    shortcut: '/favicon.ico',
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
