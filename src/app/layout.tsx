import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clearline — RFx to award',
  description:
    'Drafts an RFx, reads whatever vendors send back, and lets a buyer interrogate the result in plain language.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
