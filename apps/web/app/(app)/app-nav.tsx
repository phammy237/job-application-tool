'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/profile', label: 'Profile' },
  { href: '/applications', label: 'Applications' },
  { href: '/resumes', label: 'Resumes' },
  { href: '/network', label: 'Network' },
  { href: '/settings', label: 'Settings' },
];

/**
 * The sidebar nav — split out from the (server) AppLayout purely because active-route
 * highlighting needs `usePathname()`, which requires a client component. Exact match or a
 * "/segment" prefix (never a bare `.startsWith`, which would wrongly light up e.g.
 * "/dashboard" for a hypothetical "/dashboard-archive" route).
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-1 px-2">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'bg-accent text-accent-foreground block rounded-md px-3 py-2 text-sm font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground block rounded-md px-3 py-2 text-sm font-medium'
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
