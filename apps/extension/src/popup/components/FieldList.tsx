import type { ReviewableField } from '@career-os/shared';
import type { FillResult } from '../../content-script/fill/fill-engine';
import { BUTTON_STYLE, PRIMARY_BUTTON_STYLE } from '../styles';
import { FieldReviewRow } from './FieldReviewRow';

const SECTION_TITLES: Record<ReviewableField['reviewState'], string> = {
  READY: 'Ready to fill',
  SUGGESTED: 'Needs your review',
  PENDING_SUGGESTION: 'Not yet suggested',
  NEEDS_INPUT: 'Needs your input',
  ALREADY_COMPLETED: 'Already completed',
  SENSITIVE: 'Sensitive — always manual',
  UNSUPPORTED: 'Manual — unsupported',
};

/** Render order: the states a user can act on first, structurally-manual states last. */
const SECTION_ORDER: ReviewableField['reviewState'][] = [
  'READY',
  'SUGGESTED',
  'PENDING_SUGGESTION',
  'NEEDS_INPUT',
  'ALREADY_COMPLETED',
  'SENSITIVE',
  'UNSUPPORTED',
];

/**
 * Grouped, stateful field review (docs/IMPLEMENTATION_PLAN.md Phase 4A) — supersedes the old
 * Phase 2 read-only list. Every field is bucketed by `reviewState`; approve/edit/skip controls
 * only ever render inside FieldReviewRow for READY/SUGGESTED, per CLAUDE.md's "there is
 * structurally no suggestion to approve" rule for every other classification/state.
 */
export function FieldList({
  fields,
  loadingIds,
  onRequestSuggestion,
  onRequestAllSuggestions,
  onApprove,
  onSkip,
  onEdit,
  onResetDecision,
  onApproveAllEligible,
  fillResults,
  canAutofill,
  autofillRunning,
  onAutofill,
}: {
  fields: Record<string, ReviewableField>;
  loadingIds: Record<string, boolean>;
  onRequestSuggestion: (fieldId: string) => void;
  onRequestAllSuggestions: () => void;
  onApprove: (fieldId: string) => void;
  onSkip: (fieldId: string) => void;
  onEdit: (fieldId: string, text: string) => void;
  onResetDecision: (fieldId: string) => void;
  onApproveAllEligible: () => void;
  fillResults: FillResult[];
  canAutofill: boolean;
  autofillRunning: boolean;
  onAutofill: () => void;
}) {
  const allFields = Object.values(fields);
  const fillResultByFieldId = new Map(fillResults.map((result) => [result.fieldId, result]));

  if (allFields.length === 0) {
    return <p style={{ fontSize: 13, color: '#666' }}>No form fields detected on this page.</p>;
  }

  const grouped = new Map<ReviewableField['reviewState'], ReviewableField[]>();
  for (const field of allFields) {
    const bucket = grouped.get(field.reviewState) ?? [];
    bucket.push(field);
    grouped.set(field.reviewState, bucket);
  }

  const hasFieldsToSuggest = (grouped.get('PENDING_SUGGESTION')?.length ?? 0) > 0;
  const hasReadyFieldsToApprove = allFields.some(
    (field) => field.reviewState === 'READY' && field.approvalState === 'PENDING',
  );

  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>
        Detected fields ({allFields.length})
      </p>

      {hasFieldsToSuggest || hasReadyFieldsToApprove ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {hasFieldsToSuggest ? (
            <button type="button" style={BUTTON_STYLE} onClick={onRequestAllSuggestions}>
              Suggest all eligible
            </button>
          ) : null}
          {hasReadyFieldsToApprove ? (
            <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={onApproveAllEligible}>
              Approve all ready
            </button>
          ) : null}
        </div>
      ) : null}

      {canAutofill ? (
        <div style={{ marginBottom: 10 }}>
          <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={onAutofill} disabled={autofillRunning}>
            {autofillRunning ? 'Autofilling…' : 'Autofill approved fields'}
          </button>
          <p style={{ fontSize: 11, color: '#666', margin: '4px 0 0' }}>
            Only fills the fields you approved above. Never submits the form.
          </p>
        </div>
      ) : null}

      {SECTION_ORDER.filter((state) => grouped.has(state)).map((state) => {
        const sectionFields = grouped.get(state)!;
        return (
          <section key={state} aria-label={SECTION_TITLES[state]} style={{ marginBottom: 10 }}>
            <h2
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                color: '#475569',
                margin: '0 0 4px',
              }}
            >
              {SECTION_TITLES[state]} ({sectionFields.length})
            </h2>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {sectionFields.map((field) => (
                <FieldReviewRow
                  key={field.detected.fieldId}
                  field={field}
                  loading={Boolean(loadingIds[field.detected.fieldId])}
                  fillResult={fillResultByFieldId.get(field.detected.fieldId) ?? null}
                  onRequestSuggestion={() => onRequestSuggestion(field.detected.fieldId)}
                  onApprove={() => onApprove(field.detected.fieldId)}
                  onSkip={() => onSkip(field.detected.fieldId)}
                  onEdit={(text) => onEdit(field.detected.fieldId, text)}
                  onResetDecision={() => onResetDecision(field.detected.fieldId)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
