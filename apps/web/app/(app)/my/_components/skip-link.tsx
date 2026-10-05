export const MYOS_CONTENT_ID = 'myos-content';

/** Skip link: visible only on keyboard focus, jumps past the app and myOS navigation. */
export function SkipToContent({ targetId = MYOS_CONTENT_ID }: { targetId?: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="bg-primary text-primary-foreground focus-visible:ring-ring sr-only z-50 rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2"
    >
      Skip to main content
    </a>
  );
}
