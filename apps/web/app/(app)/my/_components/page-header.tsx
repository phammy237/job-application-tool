import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Consistent myOS page header: optional breadcrumb, title, one-line description, and the page's
 * primary action on the right (wraps below the title on narrow screens). Server- and client-safe.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: { href: string; label: string };
  /** Extra header content below the description (badges, meta). */
  children?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      {breadcrumb ? (
        <nav aria-label="Breadcrumb" className="text-sm">
          <Link
            href={breadcrumb.href}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-10 items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2"
          >
            <span aria-hidden="true">←</span> {breadcrumb.label}
          </Link>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="break-words text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Wraps mutation UI. In read-only mode (the dev preview) every control inside is disabled via a
 * disabled <fieldset>, so no server action can be submitted. `className` styles the wrapper
 * (default `contents`, i.e. no box) and applies in both modes so layout is identical.
 */
export function Mutation({
  readOnly,
  className,
  children,
}: {
  readOnly?: boolean;
  className?: string;
  children: ReactNode;
}) {
  if (!readOnly) {
    return className ? <div className={className}>{children}</div> : <>{children}</>;
  }
  return (
    <fieldset
      disabled
      aria-disabled="true"
      title="Read-only preview"
      className={`min-w-0 ${className ?? 'contents'}`}
    >
      {children}
    </fieldset>
  );
}
