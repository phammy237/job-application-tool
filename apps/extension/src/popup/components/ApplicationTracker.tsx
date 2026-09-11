import { useState } from 'react';
import type { ConsistencyFinding } from '@career-os/shared';
import { API_BASE_URL } from '../../lib/api-client';
import type { TrackerStatus } from '../hooks/useApplicationTracker';
import { BUTTON_STYLE, MUTED_STYLE, PRIMARY_BUTTON_STYLE } from '../styles';

const NOT_YET_APPLIED_STATUSES = new Set(['SAVED', 'IN_PROGRESS']);

function timeAgoLabel(lastSavedAt: number | null): string | null {
  if (!lastSavedAt) return null;
  const seconds = Math.round((Date.now() - lastSavedAt) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

/**
 * Compact save/update/mark-applied controls for the popup (docs/IMPLEMENTATION_PLAN.md Phase
 * 4C, extended in Phase 5B.2I). "Mark as applied" is deliberately its own section with its own
 * confirm step — never a side effect of Save, never pre-checked, never auto-triggered by
 * autofill completing. As of Phase 5B.2, confirming first runs an advisory consistency check
 * (`onStartMarkApplied`); a clean result proceeds straight through, anything found renders a
 * compact review step here instead — WARNING findings get an unchecked-by-default acknowledgement
 * checkbox each, BLOCKING findings are shown with no way to acknowledge them at all. No
 * consistency-rule logic lives in this component or anywhere in the extension — every finding
 * shown here came from the server (docs/IMPLEMENTATION_PLAN.md Phase 5B.2I: "no local
 * consistency-rule duplication").
 */
export function ApplicationTracker({
  applicationId,
  trackedStatus,
  status,
  errorMessage,
  lastSavedAt,
  reviewFindings,
  acknowledgedIds,
  onSave,
  onStartMarkApplied,
  onConfirmMarkApplied,
  onToggleAcknowledgement,
  onCancelReview,
}: {
  applicationId: string | null;
  trackedStatus: string | null;
  status: TrackerStatus;
  errorMessage: string | null;
  lastSavedAt: number | null;
  reviewFindings: ConsistencyFinding[] | null;
  acknowledgedIds: Set<string>;
  onSave: () => void;
  onStartMarkApplied: () => void;
  onConfirmMarkApplied: () => void;
  onToggleAcknowledgement: (findingId: string, acknowledged: boolean) => void;
  onCancelReview: () => void;
}) {
  const [confirmingMarkApplied, setConfirmingMarkApplied] = useState(false);

  const isBusy =
    status === 'saving' ||
    status === 'marking-applied' ||
    status === 'checking' ||
    status === 'checking-consistency';
  const savedLabel = timeAgoLabel(lastSavedAt);
  const canMarkApplied =
    applicationId && trackedStatus && NOT_YET_APPLIED_STATUSES.has(trackedStatus);
  // Deliberately not `status === 'reviewing-consistency'` — reviewFindings stays set while a
  // confirmed submission is in flight (status becomes 'marking-applied'), and this panel must
  // keep rendering the review UI (with its Confirm button showing "Marking…") through that
  // window, not fall back to the plain confirm step.
  const reviewing = reviewFindings !== null;
  const blocking = reviewFindings?.filter((f) => f.severity === 'BLOCKING') ?? [];
  const warnings = reviewFindings?.filter((f) => f.severity === 'WARNING') ?? [];
  const allWarningsAcknowledged = warnings.every((f) => acknowledgedIds.has(f.id));

  return (
    <div style={{ borderTop: '1px solid #eee', marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={PRIMARY_BUTTON_STYLE}
          onClick={onSave}
          disabled={isBusy}
        >
          {status === 'saving'
            ? 'Saving…'
            : applicationId
              ? 'Update saved application'
              : 'Save application'}
        </button>

        {trackedStatus ? (
          <span style={{ ...MUTED_STYLE, fontWeight: 600 }}>
            Tracker status: {trackedStatus}
          </span>
        ) : null}
      </div>

      {status === 'checking' ? (
        <p style={MUTED_STYLE}>Checking whether this job is already tracked…</p>
      ) : null}

      {status === 'saved' && savedLabel ? (
        <p style={{ ...MUTED_STYLE, color: '#166534', margin: '4px 0 0' }}>
          Saved — {savedLabel}
        </p>
      ) : null}

      {status === 'error' && errorMessage ? (
        <p style={{ fontSize: 12, color: '#b91c1c', margin: '4px 0 0' }}>
          {errorMessage}
        </p>
      ) : null}

      {applicationId ? (
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          <a
            href={`${API_BASE_URL}/applications/${applicationId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View in dashboard
          </a>
        </p>
      ) : null}

      {canMarkApplied ? (
        <div style={{ marginTop: 10 }}>
          {reviewing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...MUTED_STYLE, fontWeight: 600 }}>
                Review before marking applied
              </span>

              {blocking.map((finding) => (
                <div
                  key={finding.id}
                  style={{
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  <p
                    style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#b91c1c' }}
                  >
                    Contradiction — cannot submit as-is
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12 }}>{finding.description}</p>
                </div>
              ))}

              {warnings.map((finding) => (
                <label
                  key={finding.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={acknowledgedIds.has(finding.id)}
                    disabled={status === 'marking-applied'}
                    onChange={(e) =>
                      onToggleAcknowledgement(finding.id, e.target.checked)
                    }
                  />
                  <span>{finding.description}</span>
                </label>
              ))}

              {blocking.length > 0 ? (
                <p style={MUTED_STYLE}>
                  Fix the underlying answer and check again — a contradiction like this
                  can&apos;t be acknowledged away.
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  style={PRIMARY_BUTTON_STYLE}
                  disabled={
                    blocking.length > 0 ||
                    !allWarningsAcknowledged ||
                    status === 'marking-applied'
                  }
                  onClick={onConfirmMarkApplied}
                >
                  {status === 'marking-applied' ? 'Marking…' : 'Confirm — mark applied'}
                </button>
                <button type="button" style={BUTTON_STYLE} onClick={onCancelReview}>
                  Cancel
                </button>
              </div>
            </div>
          ) : confirmingMarkApplied ? (
            <div
              style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span style={MUTED_STYLE}>Mark this application as applied?</span>
              <button
                type="button"
                style={PRIMARY_BUTTON_STYLE}
                disabled={isBusy}
                onClick={() => {
                  setConfirmingMarkApplied(false);
                  onStartMarkApplied();
                }}
              >
                {status === 'checking-consistency'
                  ? 'Checking…'
                  : status === 'marking-applied'
                    ? 'Marking…'
                    : 'Yes, mark applied'}
              </button>
              <button
                type="button"
                style={BUTTON_STYLE}
                onClick={() => setConfirmingMarkApplied(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              style={BUTTON_STYLE}
              disabled={isBusy}
              onClick={() => setConfirmingMarkApplied(true)}
            >
              Mark as applied
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
