import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Career OS',
    template: '%s · Career OS',
  },
  description:
    'A privacy-first job application assistant: an approve-before-use candidate profile, an AI tailoring system that never fabricates a fact, and an application tracker that stays under your control.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
