import { errorMessage, noticeMessage } from './feedback-messages';

/** aria-live region for the `?notice=` / `?error=` outcome codes set by the myOS server actions. */
export function Feedback({ notice, error }: { notice?: string; error?: string }) {
  const errorText = errorMessage(error);
  const noticeText = noticeMessage(notice);
  return (
    <div id="feedback" aria-live="polite" role="status">
      {errorText ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorText}
        </p>
      ) : null}
      {noticeText && !errorText ? (
        <p className="border-border bg-accent text-accent-foreground rounded-md border px-3 py-2 text-sm">
          {noticeText}
        </p>
      ) : null}
    </div>
  );
}

/** Next passes searchParams values as string | string[]; take the first string, bounded. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v.slice(0, 64) : undefined;
}
