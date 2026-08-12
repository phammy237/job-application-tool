import { useState } from 'react';
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
 * 4C). "Mark as applied" is deliberately its own section with its own confirm step — never a
 * side effect of Save, never pre-checked, never auto-triggered by autofill completing.
 */
export function ApplicationTracker({
  applicationId,
  trackedStatus,
  status,
  errorMessage,
  lastSavedAt,
  onSave,
  onMarkApplied,
}: {
  applicationId: string | null;
  trackedStatus: string | null;
  status: TrackerStatus;
  errorMessage: string | null;
  lastSavedAt: number | null;
  onSave: () => void;
  onMarkApplied: () => void;
}) {
  const [confirmingMarkApplied, setConfirmingMarkApplied] = useState(false);

  const isBusy = status === 'saving' || status === 'marking-applied' || status === 'checking';
  const savedLabel = timeAgoLabel(lastSavedAt);
  const canMarkApplied = applicationId && trackedStatus && NOT_YET_APPLIED_STATUSES.has(trackedStatus);

  return (
    <div style={{ borderTop: '1px solid #eee', marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={PRIMARY_BUTTON_STYLE} onClick={onSave} disabled={isBusy}>
          {status === 'saving' ? 'Saving…' : applicationId ? 'Update saved application' : 'Save application'}
        </button>

        {trackedStatus ? (
          <span style={{ ...MUTED_STYLE, fontWeight: 600 }}>Tracker status: {trackedStatus}</span>
        ) : null}
      </div>

      {status === 'checking' ? <p style={MUTED_STYLE}>Checking whether this job is already tracked…</p> : null}

      {status === 'saved' && savedLabel ? (
        <p style={{ ...MUTED_STYLE, color: '#166534', margin: '4px 0 0' }}>Saved — {savedLabel}</p>
      ) : null}

      {status === 'error' && errorMessage ? (
        <p style={{ fontSize: 12, color: '#b91c1c', margin: '4px 0 0' }}>{errorMessage}</p>
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
          {confirmingMarkApplied ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={MUTED_STYLE}>Mark this application as applied?</span>
              <button
                type="button"
                style={PRIMARY_BUTTON_STYLE}
                disabled={isBusy}
                onClick={() => {
                  setConfirmingMarkApplied(false);
                  onMarkApplied();
                }}
              >
                {status === 'marking-applied' ? 'Marking…' : 'Yes, mark applied'}
              </button>
              <button type="button" style={BUTTON_STYLE} onClick={() => setConfirmingMarkApplied(false)}>
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
