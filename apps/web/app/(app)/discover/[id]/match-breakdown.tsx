import type { ScoreComponent } from '@career-os/shared';
import { CRITERION_LABELS } from '../discovery-display-labels';

/**
 * Renders the persisted `score_components` array exactly as computed by `computeMatchScore`
 * (packages/shared/src/lib/match-score.ts) — never recomputed here. A criterion with `weight: 0`
 * is the user's own scoring profile turning that criterion off entirely, so it's omitted rather
 * than shown as "0% fit" (docs/JOB_DISCOVERY.md "Match-score math" — disabled is not the same as
 * unknown, and neither is the same as a bad fit).
 */
export function MatchBreakdown({ components }: { components: ScoreComponent[] }) {
  const enabled = components.filter((component) => component.weight > 0);

  if (enabled.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No scoring criteria are currently enabled in your profile.
      </p>
    );
  }

  return (
    <ul className="divide-border divide-y text-sm">
      {enabled.map((component) => (
        <li key={component.criterion} className="flex items-center justify-between py-2">
          <span>{CRITERION_LABELS[component.criterion] ?? component.criterion}</span>
          {component.known && component.fit !== null ? (
            <span className="font-medium">{Math.round(component.fit * 100)}% fit</span>
          ) : (
            <span className="text-muted-foreground">Not evaluated for this posting</span>
          )}
        </li>
      ))}
    </ul>
  );
}
