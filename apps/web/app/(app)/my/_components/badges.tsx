import type {
  SkillStrengthLevel,
  VerificationState,
  Visibility,
} from '@career-os/shared';
import type { ReactNode } from 'react';

/**
 * Small presentational pieces shared across the myOS UI. Server- and client-safe (no hooks, no
 * server-only imports). Meaning is always carried by text, never by colour alone.
 */

const BASE =
  'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium';

const VERIFICATION: Record<
  VerificationState,
  { label: string; hint: string; cls: string }
> = {
  VERIFIED: {
    label: 'Verified',
    hint: 'Directly observed from a source system',
    cls: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  },
  USER_PROVIDED: {
    label: 'You confirmed',
    hint: 'You entered or confirmed this',
    cls: 'border-primary/30 bg-accent text-accent-foreground',
  },
  INFERRED: {
    label: 'Inferred',
    hint: 'Derived automatically; not yet confirmed by you',
    cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  AI_GENERATED: {
    label: 'AI-generated',
    hint: 'Produced by a model; not confirmed by you',
    cls: 'border-dashed border-border bg-muted text-muted-foreground',
  },
};

export function VerificationBadge({ state }: { state: VerificationState }) {
  const v = VERIFICATION[state];
  return (
    <span className={`${BASE} ${v.cls}`} title={v.hint}>
      {v.label}
    </span>
  );
}

const VISIBILITY: Record<Visibility, { label: string; hint: string; cls: string }> = {
  PRIVATE: {
    label: 'Private',
    hint: 'Only you can see this',
    cls: 'border-border bg-secondary text-secondary-foreground',
  },
  CAREER_OS_ONLY: {
    label: 'Career OS only',
    hint: 'Used inside Career OS; never exported',
    cls: 'border-border bg-background text-foreground',
  },
  PUBLIC: {
    label: 'Public',
    hint: 'May appear in your portfolio export if the portfolio is enabled',
    cls: 'border-primary/30 bg-primary/10 text-primary',
  },
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const v = VISIBILITY[visibility];
  return (
    <span className={`${BASE} ${v.cls}`} title={v.hint}>
      {v.label}
    </span>
  );
}

/** Evidence-based support level, not a proficiency rating. */
const STRENGTH: Record<SkillStrengthLevel, { label: string; cls: string }> = {
  NONE: {
    label: 'No evidence',
    cls: 'border-dashed border-border text-muted-foreground',
  },
  LIMITED: {
    label: 'Limited',
    cls: 'border-border bg-secondary text-secondary-foreground',
  },
  MODERATE: {
    label: 'Moderate',
    cls: 'border-primary/30 bg-accent text-accent-foreground',
  },
  STRONG: {
    label: 'Well supported',
    cls: 'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  },
};

export function StrengthBadge({ level }: { level: SkillStrengthLevel }) {
  const v = STRENGTH[level];
  return (
    <span
      className={`${BASE} ${v.cls}`}
      title="Based on how much approved evidence supports this skill, not a rating of how proficient you are."
    >
      {v.label}
    </span>
  );
}

/** Neutral pill for flags such as "Unapproved" or "No evidence". */
export function FlagBadge({
  children,
  tone = 'warn',
}: {
  children: ReactNode;
  tone?: 'warn' | 'neutral';
}) {
  const cls =
    tone === 'warn'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
      : 'border-border bg-secondary text-secondary-foreground';
  return <span className={`${BASE} ${cls}`}>{children}</span>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
