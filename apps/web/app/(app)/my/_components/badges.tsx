import type {
  SkillStrengthLevel,
  VerificationState,
  Visibility,
} from '@career-os/shared';
import type { ReactNode } from 'react';
import { PILL_BASE, TONE_DOT, TONE_PILL, type Tone } from './tones';

/**
 * Small presentational pieces shared across the myOS UI. Server- and client-safe (no hooks, no
 * server-only imports). Meaning is always carried by text, never by colour alone; colours come
 * only from the semantic tone map in ./tones.ts (theme tokens).
 */

/** Generic semantic pill. */
export function TonePill({
  tone,
  children,
  title,
  dot = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`${PILL_BASE} ${TONE_PILL[tone]} ${className ?? ''}`} title={title}>
      {dot ? (
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]}`}
        />
      ) : null}
      {children}
    </span>
  );
}

const VERIFICATION: Record<
  VerificationState,
  { label: string; hint: string; tone: Tone }
> = {
  VERIFIED: {
    label: 'Verified',
    hint: 'Directly observed from a source system',
    tone: 'success',
  },
  USER_PROVIDED: {
    label: 'You confirmed',
    hint: 'You entered or confirmed this',
    tone: 'primary',
  },
  INFERRED: {
    label: 'Inferred',
    hint: 'Derived automatically; not yet confirmed by you',
    tone: 'warning',
  },
  AI_GENERATED: {
    label: 'AI-generated',
    hint: 'Produced by a model; not confirmed by you',
    tone: 'muted',
  },
};

export function VerificationBadge({ state }: { state: VerificationState }) {
  const v = VERIFICATION[state];
  return (
    <TonePill tone={v.tone} title={v.hint} dot>
      {v.label}
    </TonePill>
  );
}

const VISIBILITY: Record<Visibility, { label: string; hint: string; tone: Tone }> = {
  PRIVATE: { label: 'Private', hint: 'Only you can see this', tone: 'neutral' },
  CAREER_OS_ONLY: {
    label: 'Career OS only',
    hint: 'Used inside Career OS; never exported',
    tone: 'neutral',
  },
  PUBLIC: {
    label: 'Public',
    hint: 'May appear in your portfolio export if the portfolio is enabled',
    tone: 'primary',
  },
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const v = VISIBILITY[visibility];
  return (
    <TonePill tone={v.tone} title={v.hint}>
      {v.label}
    </TonePill>
  );
}

/** Evidence-based support level, not a proficiency rating. */
const STRENGTH: Record<SkillStrengthLevel, { label: string; tone: Tone }> = {
  NONE: { label: 'No evidence', tone: 'muted' },
  LIMITED: { label: 'Limited', tone: 'neutral' },
  MODERATE: { label: 'Moderate', tone: 'primary' },
  STRONG: { label: 'Well supported', tone: 'success' },
};

export function StrengthBadge({ level }: { level: SkillStrengthLevel }) {
  const v = STRENGTH[level];
  return (
    <TonePill
      tone={v.tone}
      dot
      title="Based on how much approved evidence supports this skill, not a rating of how proficient you are."
    >
      {v.label}
    </TonePill>
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
  return (
    <TonePill tone={tone === 'warn' ? 'warning' : 'neutral'}>
      {tone === 'warn' ? <span aria-hidden="true">!</span> : null}
      {children}
    </TonePill>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="border-border rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <div className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Small uppercase label used above compact lists inside sections. */
export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
      {children}
    </h4>
  );
}
