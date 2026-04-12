import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spotzy — Find Your Perfect Parking Spot',
  description:
    'Spotzy connects drivers with hosts who rent out private parking spots by the hour.',
  openGraph: {
    title: 'Spotzy',
    description: 'Find and book private parking spots near you.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#F0F7F3] text-[#004526] antialiased">
        {children}
      </body>
    </html>
  );
}
