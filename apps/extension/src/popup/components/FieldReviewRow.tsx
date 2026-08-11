import { useState } from 'react';
import type { ReviewableField } from '@career-os/shared';
import { BUTTON_STYLE, MUTED_STYLE, PRIMARY_BUTTON_STYLE } from '../styles';

const ROW_STYLE: React.CSSProperties = {
  padding: '8px 0',
  borderBottom: '1px solid #eee',
  fontSize: 13,
};

const LABEL_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  alignItems: 'baseline',
};

const DECISION_LABELS: Record<string, string> = {
  APPROVED: 'Approved — will be filled',
  EDITED: 'Edited — will be filled',
  SKIPPED: 'Skipped — left untouched',
};

function displayLabel(field: ReviewableField['detected']): string {
  return field.label ?? field.htmlName ?? field.htmlId ?? '(unlabeled field)';
}

/** One detected field's review row — controls shown depend entirely on `field.reviewState`;
 * approve/edit/skip only ever render for READY/SUGGESTED (docs/IMPLEMENTATION_PLAN.md Phase 4A:
 * every other state has structurally nothing to decide on). */
export function FieldReviewRow({
  field,
  loading,
  onRequestSuggestion,
  onApprove,
  onSkip,
  onEdit,
  onResetDecision,
}: {
  field: ReviewableField;
  loading: boolean;
  onRequestSuggestion: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onEdit: (text: string) => void;
  onResetDecision: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(field.suggestion?.answer ?? '');

  const label = displayLabel(field.detected);

  return (
    <li style={ROW_STYLE}>
      <div style={LABEL_ROW_STYLE}>
        <span>{label}</span>
        <span style={{ ...MUTED_STYLE, whiteSpace: 'nowrap' }}>{field.detected.classification}</span>
      </div>

      {field.reviewState === 'SENSITIVE' ? (
        <p style={MUTED_STYLE}>Always requires your direct input — never suggested.</p>
      ) : null}

      {field.reviewState === 'UNSUPPORTED' ? (
        <p style={MUTED_STYLE}>Fill this one in yourself.</p>
      ) : null}

      {field.reviewState === 'ALREADY_COMPLETED' ? (
        <>
          <p style={MUTED_STYLE}>Already filled in: "{field.detected.currentValue}"</p>
          <button type="button" style={BUTTON_STYLE} onClick={onRequestSuggestion} disabled={loading}>
            {loading ? 'Getting suggestion…' : 'Suggest a replacement anyway'}
          </button>
        </>
      ) : null}

      {field.reviewState === 'PENDING_SUGGESTION' ? (
        <button type="button" style={BUTTON_STYLE} onClick={onRequestSuggestion} disabled={loading}>
          {loading ? 'Getting suggestion…' : 'Get suggestion'}
        </button>
      ) : null}

      {field.reviewState === 'NEEDS_INPUT' ? (
        <>
          <p style={MUTED_STYLE}>No suggestion available — fill this one in yourself.</p>
          <button type="button" style={BUTTON_STYLE} onClick={onRequestSuggestion} disabled={loading}>
            {loading ? 'Trying again…' : 'Try again'}
          </button>
        </>
      ) : null}

      {(field.reviewState === 'READY' || field.reviewState === 'SUGGESTED') && field.suggestion ? (
        <div style={{ marginTop: 4 }}>
          {field.reviewState === 'SUGGESTED' ? (
            <p style={{ ...MUTED_STYLE, color: '#92400e', margin: '0 0 4px' }}>
              AI-generated draft — review before approving.
            </p>
          ) : (
            <p style={{ ...MUTED_STYLE, color: '#166534', margin: '0 0 4px' }}>High-confidence match.</p>
          )}

          {isEditing ? (
            <div>
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                rows={3}
                style={{ width: '100%', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  style={PRIMARY_BUTTON_STYLE}
                  onClick={() => {
                    onEdit(draftText);
                    setIsEditing(false);
                  }}
                >
                  Save edit
                </button>
                <button type="button" style={BUTTON_STYLE} onClick={() => setIsEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p style={{ margin: '0 0 4px', whiteSpace: 'pre-wrap' }}>
              {field.approvalState === 'EDITED' && field.editedText ? field.editedText : field.suggestion.answer}
            </p>
          )}

          {field.suggestion.reasoningSummary ? (
            <p style={MUTED_STYLE}>{field.suggestion.reasoningSummary}</p>
          ) : null}
          <p style={MUTED_STYLE}>Confidence: {Math.round(field.suggestion.confidence * 100)}%</p>

          {!isEditing ? (
            field.approvalState === 'PENDING' ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={onApprove}>
                  Approve
                </button>
                <button
                  type="button"
                  style={BUTTON_STYLE}
                  onClick={() => {
                    setDraftText(field.suggestion?.answer ?? '');
                    setIsEditing(true);
                  }}
                >
                  Edit
                </button>
                <button type="button" style={BUTTON_STYLE} onClick={onSkip}>
                  Skip
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span style={{ ...MUTED_STYLE, fontWeight: 600 }}>
                  {DECISION_LABELS[field.approvalState]}
                </span>
                <button type="button" style={BUTTON_STYLE} onClick={onResetDecision}>
                  Undo
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {field.errorMessage ? (
        <p style={{ fontSize: 12, color: '#b91c1c', margin: '4px 0 0' }}>{field.errorMessage}</p>
      ) : null}
    </li>
  );
}
