'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

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

export interface SubnavItem {
  href: string;
  label: string;
  active: boolean;
}

/**
 * Sticky, horizontally scrollable tab bar. The active tab is scrolled into view (horizontally
 * only, so the page itself never jumps) and marked with aria-current plus a visible underline
 * and weight change, so colour is not the only cue.
 */
export function SubnavBar({ items, label }: { items: SubnavItem[]; label: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const activeHref = items.find((i) => i.active)?.href;

  useEffect(() => {
    const el = scroller.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active) return;
    const target = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    el.scrollLeft = Math.max(0, target);
  }, [activeHref]);

  return (
    <nav
      aria-label={label}
      className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-20 -mx-4 border-b px-4 backdrop-blur sm:-mx-6 sm:px-6"
    >
      <div ref={scroller} className="overflow-x-auto [scrollbar-width:thin]">
        <ul className="flex min-w-max gap-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={`focus-visible:ring-ring -mb-px flex min-h-11 items-center border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  item.active
                    ? 'border-primary text-foreground font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:border-border border-transparent font-medium'
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

/** Secondary navigation for the myOS area. */
export function MySubnav() {
  const pathname = usePathname();
  return (
    <SubnavBar
      label="myOS sections"
      items={ITEMS.map((item) => ({
        href: item.href,
        label: item.label,
        active: item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`),
      }))}
    />
  );
}
