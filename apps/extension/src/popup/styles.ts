import type { CSSProperties } from 'react';

/** Shared inline-style constants for the popup's review UI (FieldReviewRow, FieldList) — kept
 * in one place rather than duplicated per component, matching this extension's existing
 * convention (plain inline styles, no CSS framework — see AnalyzeButton/JobSummary). */
export const MUTED_STYLE: CSSProperties = { color: '#666', fontSize: 12 };

export const BUTTON_STYLE: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 5,
  border: '1px solid #cbd5e1',
  background: 'white',
  cursor: 'pointer',
};

export const PRIMARY_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  border: 'none',
  background: '#1e293b',
  color: 'white',
};
