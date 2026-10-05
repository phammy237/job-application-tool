/**
 * The ONE place myOS maps semantic meaning (success / warning / danger / info / neutral /
 * primary / muted) to colour. Colours come only from theme CSS variables in
 * apps/web/app/globals.css: the core tokens (primary, secondary, muted, border, destructive) and
 * the semantic `--tone-*` variables, so a palette swap is a globals.css edit. Do not hard-code
 * palette classes (bg-amber-50, text-green-700, ...) in myOS UI; use these maps instead.
 *
 * Text is always `text-foreground` (or a core *-foreground pair) on a light tint, so contrast is
 * that of ink on paper (>= 4.5:1) in both themes; the tone is carried by border, tint and dot,
 * and meaning is always also carried by text.
 */
export type Tone =
  'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'muted';

/** Pill / badge classes (border + tint + text). */
export const TONE_PILL: Record<Tone, string> = {
  success:
    'border-[hsl(var(--tone-success)/0.55)] bg-[hsl(var(--tone-success)/0.14)] text-foreground',
  warning:
    'border-[hsl(var(--tone-warning)/0.7)] bg-[hsl(var(--tone-warning)/0.18)] text-foreground',
  danger:
    'border-[hsl(var(--tone-danger)/0.55)] bg-[hsl(var(--tone-danger)/0.12)] text-foreground',
  info: 'border-[hsl(var(--tone-info)/0.8)] bg-[hsl(var(--tone-info)/0.2)] text-foreground',
  primary: 'border-primary/40 bg-primary/10 text-foreground',
  neutral: 'border-border bg-secondary text-secondary-foreground',
  muted: 'border-dashed border-border bg-muted text-muted-foreground',
};

/** Callout / panel surfaces (notes, warnings, verdict boxes). */
export const TONE_PANEL: Record<Tone, string> = {
  success: 'border-[hsl(var(--tone-success)/0.45)] bg-[hsl(var(--tone-success)/0.07)]',
  warning: 'border-[hsl(var(--tone-warning)/0.6)] bg-[hsl(var(--tone-warning)/0.1)]',
  danger: 'border-[hsl(var(--tone-danger)/0.45)] bg-[hsl(var(--tone-danger)/0.06)]',
  info: 'border-[hsl(var(--tone-info)/0.6)] bg-[hsl(var(--tone-info)/0.1)]',
  primary: 'border-primary/30 bg-primary/5',
  neutral: 'border-border bg-card',
  muted: 'border-dashed border-border bg-muted/40',
};

/** Small coloured dot that accompanies a text label (never the only cue). */
export const TONE_DOT: Record<Tone, string> = {
  success: 'bg-[hsl(var(--tone-success))]',
  warning: 'bg-[hsl(var(--tone-warning))]',
  danger: 'bg-[hsl(var(--tone-danger))]',
  info: 'bg-[hsl(var(--tone-info))]',
  primary: 'bg-primary',
  neutral: 'bg-muted-foreground',
  muted: 'border border-muted-foreground bg-transparent',
};

export const PILL_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium';
