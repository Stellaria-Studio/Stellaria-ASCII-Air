import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ascii-sky-st-combat.aethra2007.chatgpt.site'),
  title: 'ASCII SKY // ST Combat System',
  description: 'A true 3D air-combat simulation presented through a living terminal display.',
  openGraph: {
    title: 'ASCII SKY // ST Combat System',
    description: 'Lock the signal. Own the sky.',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'ASCII SKY terminal air combat over Ridge City' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ASCII SKY // ST Combat System',
    description: 'Lock the signal. Own the sky.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
