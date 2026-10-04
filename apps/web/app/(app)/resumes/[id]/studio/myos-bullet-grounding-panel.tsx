'use client';

import type { StructuredResumeV1 } from '@career-os/shared';
import Link from 'next/link';
import { useMemo } from 'react';
import {
  hasGroundingWarning,
  listResumeBullets,
  type BulletGrounding,
  type BulletGroundingMap,
} from '../../../../../lib/myos/bullet-grounding';
import { entityHref, ProvenanceBadge } from '../../../../../lib/myos/provenance-badge';

/**
 * Advisory "Why this bullet?" check. Each bullet is compared with the user's own myOS evidence
 * (computed server-side when the page loaded). It never edits, blocks or hides a bullet, and it
 * does not replace the numeric/technology guards of the tailoring pipeline: unsupported numbers
 * and technologies are shown as visible warnings. A bullet edited after the check is flagged as
 * stale instead of showing results for different text.
 */
export function MyosBulletGroundingPanel({
  draft,
  grounding,
}: {
  draft: StructuredResumeV1;
  grounding: BulletGroundingMap;
}) {
  const rows = useMemo(
    () =>
      listResumeBullets(draft)
        .filter((b) => b.text.trim().length > 0)
        .map((b) => {
          const g = grounding[b.id];
          const state: 'unchecked' | 'stale' | 'checked' = !g
            ? 'unchecked'
            : g.text !== b.text
              ? 'stale'
              : 'checked';
          return { bullet: b, g, state };
        }),
    [draft, grounding],
  );
  const warningCount = rows.filter((r) => r.state === 'checked' && hasGroundingWarning(r.g!)).length;
  const unchecked = rows.filter((r) => r.state !== 'checked').length;

  if (rows.length === 0) return null;

  return (
    <details className="border-border rounded-lg border p-3" data-testid="myos-grounding-panel">
      <summary className="cursor-pointer text-sm font-semibold">
        Evidence check (myOS)
        <span className="text-muted-foreground ml-2 text-xs font-normal">
          {warningCount} bullet{warningCount === 1 ? '' : 's'} with warnings
          {unchecked > 0 ? `, ${unchecked} not checked (new or edited)` : ''}
        </span>
      </summary>
      <p className="text-muted-foreground mt-2 text-xs">
        Advisory only: compares each bullet with the evidence you recorded in myOS. Nothing here
        changes your bullets. Save and reload to re-check edited text.
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map(({ bullet, g, state }) => (
          <li key={bullet.id} className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground text-xs">{bullet.sectionLabel}: </span>
              {bullet.text}
            </p>
            {state === 'unchecked' ? (
              <p className="text-muted-foreground text-xs">
                Not checked yet (added after this page loaded).
              </p>
            ) : state === 'stale' ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Edited since the last check, so any earlier result no longer applies. Save and
                reload to re-check.
              </p>
            ) : (
              <BulletDetails g={g!} />
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function BulletDetails({ g }: { g: BulletGrounding }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs">
        <span className="text-primary underline underline-offset-2">Why this bullet?</span>
        <span className="text-muted-foreground ml-2">support: {g.supportLevel.toLowerCase()}</span>
        {g.unsupportedNumbers.length > 0 ? (
          <span className="ml-2 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            number not backed: {g.unsupportedNumbers.join(', ')}
          </span>
        ) : null}
        {g.unsupportedTechnologies.length > 0 ? (
          <span className="ml-2 rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            technology not backed: {g.unsupportedTechnologies.join(', ')}
          </span>
        ) : null}
        {g.supportLevel === 'NONE' ? (
          <span className="border-destructive/50 text-destructive ml-2 rounded-full border px-2 py-0.5 text-[11px]">
            no supporting evidence
          </span>
        ) : null}
      </summary>
      <div className="mt-1 space-y-2 pl-3 text-xs">
        <p className="text-muted-foreground">{g.whyThisBullet}</p>
        {g.evidence.length > 0 ? (
          <ul className="space-y-2">
            {g.evidence.map((m) => (
              <li key={`${m.entityType}:${m.entityId}`} className="space-y-1">
                <p>
                  <Link
                    href={entityHref(m.entityType, m.entityId)}
                    className="text-primary underline underline-offset-2"
                  >
                    {m.name}
                  </Link>
                  <span className="text-muted-foreground ml-2">
                    {m.entityType.toLowerCase()} · overlap: {m.matchedTerms.join(', ')}
                  </span>
                  {m.unconfirmed ? (
                    <span className="ml-2 text-amber-700 dark:text-amber-400">unconfirmed</span>
                  ) : !m.grounding ? (
                    <span className="ml-2 text-amber-700 dark:text-amber-400">
                      not approved for applications
                    </span>
                  ) : null}
                </p>
                {m.evidence.length > 0 ? (
                  <ul className="flex flex-wrap gap-2 pl-3">
                    {m.evidence.map((ev) => (
                      <li key={ev.evidenceId} className="flex items-center gap-1">
                        {ev.sourceUrl ? (
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary underline"
                          >
                            {ev.title}
                          </a>
                        ) : (
                          <span>{ev.title}</span>
                        )}
                        <ProvenanceBadge
                          sourceType={ev.sourceType}
                          verificationState={ev.verificationState}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
