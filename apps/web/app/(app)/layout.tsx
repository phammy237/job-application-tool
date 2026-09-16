import Link from 'next/link';
import { requireUser } from '../../lib/auth';
import { SignOutButton } from './sign-out-button';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/profile', label: 'Profile' },
  { href: '/applications', label: 'Applications' },
  { href: '/resumes', label: 'Resumes' },
  { href: '/network', label: 'Network' },
  { href: '/settings', label: 'Settings' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="border-border bg-card flex w-56 shrink-0 flex-col border-r">
        <div className="px-4 py-5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Career OS
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground block rounded-md px-3 py-2 text-sm font-medium"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-border border-t px-4 py-4">
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="border-border flex h-14 items-center border-b px-6">
          <div className="border-input bg-background text-muted-foreground flex w-full max-w-md items-center rounded-md border px-3 py-1.5 text-sm">
            Search — coming soon
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
