import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Kargo · Hiring', description: 'Ranked shortlist, briefs and one-click emails for PM / SPM hiring' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Kargo <span>Hiring</span></Link>
          <nav>
            <Link href="/">Dashboard</Link>
            <Link href="/rubric">Rubric</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
