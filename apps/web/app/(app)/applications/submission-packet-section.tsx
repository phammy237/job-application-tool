import {
  countOwnRequirementMappingsForRun,
  getOwnRequirementMappingRunById,
  getOwnSubmissionPacketByApplicationId,
  type CareerOsSupabaseClient,
} from '@career-os/database';
import { Badge } from '@career-os/ui';

/**
 * "What does Career OS actually have recorded about what I submitted?" (docs/IMPLEMENTATION_PLAN.md
 * Phase 5B.4). Server component — reads the packet directly (same DB access the page itself
 * already has) rather than round-tripping through the API route. Rendered only for an APPLIED
 * application; both a genuine "no packet" (legacy, Phase 5B.1G) and a real packet are honest,
 * expected states here, never an error.
 */
export async function SubmissionPacketSection({
  supabase,
  userId,
  applicationId,
}: {
  supabase: CareerOsSupabaseClient;
  userId: string;
  applicationId: string;
}) {
  const packet = await getOwnSubmissionPacketByApplicationId(
    supabase,
    userId,
    applicationId,
  );

  // The requirement-mapping run this packet froze a reference to, if any — looked up by id
  // (not "current"), since a later re-analysis may have since superseded it. Honest either way:
  // if the run no longer exists at all (should not normally happen, since runs are never
  // deleted, but nothing here assumes it), the summary is simply omitted rather than guessed.
  const requirementMappingRun = packet?.requirementMappingRunId
    ? await getOwnRequirementMappingRunById(
        supabase,
        userId,
        packet.requirementMappingRunId,
      )
    : null;
  const requirementMappingCount = requirementMappingRun
    ? await countOwnRequirementMappingsForRun(supabase, userId, requirementMappingRun.id)
    : null;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground text-sm font-medium">What you submitted</h2>

      {!packet ? (
        <p className="text-muted-foreground text-sm">
          This application was marked applied before submission snapshots were introduced,
          so a frozen submission record is unavailable for it.
        </p>
      ) : (
        <div className="border-border space-y-4 rounded-lg border p-4 text-sm">
          <p className="text-muted-foreground text-xs">
            Recorded {new Date(packet.createdAt).toLocaleString()} — frozen at the moment
            this application was marked applied; it does not change if your profile,
            résumé, or this job posting change later.
          </p>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Reviewed answers ({packet.answersSnapshot.length})
            </h3>
            {packet.answersSnapshot.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                No AI-suggested fields were reviewed for this application — Career OS has
                no literal field values recorded. It never records what you typed directly
                into the employer&apos;s page or what the browser&apos;s own autofill
                completed.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {packet.answersSnapshot.map((answer) => (
                  <li
                    key={answer.generatedAnswerId}
                    className="border-border rounded-md border p-2"
                  >
                    <p className="font-medium">{answer.fieldLabel}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {answer.finalText ?? answer.originalAnswer}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {answer.userDecision ?? 'no decision recorded'}
                      {answer.finalText ? ' · edited' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {packet.autofillSummary ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide">Autofill</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                {packet.autofillSummary.filled} filled, {packet.autofillSummary.approved}{' '}
                approved, {packet.autofillSummary.skipped} skipped,{' '}
                {packet.autofillSummary.failed} failed,{' '}
                {packet.autofillSummary.unresolved} unresolved,{' '}
                {packet.autofillSummary.manual} manual
              </p>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Consistency findings
            </h3>
            {packet.consistencyFindings.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs">
                No findings at submission time.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {packet.consistencyFindings.map((finding) => {
                  const acknowledgement = packet.consistencyAcknowledgements.find(
                    (a) => a.findingId === finding.id,
                  );
                  return (
                    <li key={finding.id} className="border-border rounded-md border p-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            finding.severity === 'BLOCKING' ? 'destructive' : 'outline'
                          }
                        >
                          {finding.severity}
                        </Badge>
                        <span>{finding.description}</span>
                      </div>
                      {acknowledgement ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          Acknowledged{' '}
                          {new Date(acknowledgement.acknowledgedAt).toLocaleString()}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {packet.requirementMappingRunId ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide">
                Requirement analysis
              </h3>
              {requirementMappingRun ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {requirementMappingCount ?? 0} requirement
                  {requirementMappingCount === 1 ? '' : 's'} analyzed on{' '}
                  {new Date(requirementMappingRun.createdAt).toLocaleString()}
                  {requirementMappingRun.status !== 'CURRENT'
                    ? ' — a newer analysis has since replaced this run for this job posting.'
                    : '.'}
                </p>
              ) : (
                <p className="text-muted-foreground mt-1 text-xs">
                  This application referenced a requirement analysis run that is no longer
                  available.
                </p>
              )}
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide">Résumé</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {packet.resumeId
                ? `Résumé ${packet.resumeId}`
                : 'The submitted résumé version is not recorded for this application.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
