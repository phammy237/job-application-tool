'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/my', label: 'Overview', exact: true },
  { href: '/my/projects', label: 'Projects' },
  { href: '/my/skills', label: 'Skills' },
  { href: '/my/timeline', label: 'Timeline' },
  { href: '/my/achievements', label: 'Achievements' },
  { href: '/my/stories', label: 'Stories' },
  { href: '/my/graph', label: 'Graph' },
  { href: '/my/ask', label: 'Ask' },
  { href: '/my/github', label: 'GitHub' },
  { href: '/my/settings', label: 'Portfolio' },
];

/** Secondary navigation for the myOS area; horizontally scrollable on narrow screens. */
export function MySubnav() {
  const pathname = usePathname();
  return (
    <nav aria-label="myOS sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b px-1">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'border-primary text-foreground -mb-px block border-b-2 px-3 py-2.5 text-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground block px-3 py-2.5 text-sm font-medium'
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
