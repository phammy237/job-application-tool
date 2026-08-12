import type {
  AutofillSummary,
  ReviewableField,
  SaveApplicationRequest,
  UnresolvedFieldSummary,
} from '@career-os/shared';
import type { FillResult } from '../../content-script/fill/fill-engine';

export type AnsweredField = SaveApplicationRequest['answeredFields'][number];

export interface AutofillProgressSummary {
  autofillSummary: AutofillSummary;
  unresolvedFields: UnresolvedFieldSummary[];
  answeredFields: AnsweredField[];
}

function displayLabel(field: ReviewableField['detected']): string | null {
  return field.label ?? field.htmlName ?? field.htmlId ?? null;
}

function unresolved(
  field: ReviewableField,
  status: UnresolvedFieldSummary['status'],
  reason: string,
): UnresolvedFieldSummary {
  return { label: displayLabel(field.detected), classification: field.detected.classification, status, reason };
}

/**
 * Maps the popup's rich, in-memory review/fill state down to the minimal wire shape
 * POST /api/applications accepts (docs/IMPLEMENTATION_PLAN.md Phase 4C) — never the full
 * ReviewableField or FillResult objects themselves, only counts and sanitized summaries. Pure
 * and DOM-free so it's unit-testable without jsdom, same as the reducer's pure functions.
 */
export function summarizeAutofillProgress(
  fields: Record<string, ReviewableField>,
  fillResults: FillResult[],
): AutofillProgressSummary {
  const resultByFieldId = new Map(fillResults.map((result) => [result.fieldId, result]));

  const summary: AutofillSummary = {
    approved: 0,
    filled: 0,
    skipped: 0,
    failed: 0,
    unresolved: 0,
    manual: 0,
  };
  const unresolvedFields: UnresolvedFieldSummary[] = [];
  const answeredFields: AnsweredField[] = [];

  for (const field of Object.values(fields)) {
    switch (field.reviewState) {
      case 'SENSITIVE':
        summary.manual += 1;
        unresolvedFields.push(unresolved(field, 'SENSITIVE', 'Always requires your direct input — never suggested.'));
        continue;
      case 'UNSUPPORTED':
        summary.manual += 1;
        unresolvedFields.push(unresolved(field, 'UNSUPPORTED', 'Fill this one in yourself.'));
        continue;
      case 'ALREADY_COMPLETED':
        // Already had a value on the page and the user never asked for a replacement — nothing
        // unresolved about it.
        continue;
      case 'NEEDS_INPUT':
        summary.unresolved += 1;
        unresolvedFields.push(unresolved(field, 'NEEDS_INPUT', 'No suggestion available — fill this one in yourself.'));
        continue;
      case 'PENDING_SUGGESTION':
        summary.unresolved += 1;
        unresolvedFields.push(unresolved(field, 'NEEDS_INPUT', 'No suggestion was requested for this field.'));
        continue;
      case 'READY':
      case 'SUGGESTED':
        break; // handled below — these are the only states with a possible approval decision
    }

    if (field.approvalState === 'SKIPPED') {
      summary.skipped += 1;
      continue;
    }
    if (field.approvalState === 'PENDING') {
      summary.unresolved += 1;
      unresolvedFields.push(unresolved(field, 'NEEDS_INPUT', 'Not yet reviewed.'));
      continue;
    }

    // APPROVED or EDITED from here on.
    summary.approved += 1;
    if (field.suggestion) {
      answeredFields.push({
        generatedAnswerId: field.suggestion.id,
        decision: field.approvalState,
        finalText: field.approvalState === 'EDITED' ? field.editedText : null,
      });
    }

    const fillResult = resultByFieldId.get(field.detected.fieldId);
    if (!fillResult) {
      summary.unresolved += 1;
      unresolvedFields.push(unresolved(field, 'NEEDS_INPUT', 'Approved but not yet filled — run autofill to apply it.'));
      continue;
    }

    switch (fillResult.status) {
      case 'success':
        summary.filled += 1;
        break;
      case 'skipped':
        summary.skipped += 1;
        break;
      case 'failed':
        summary.failed += 1;
        unresolvedFields.push(unresolved(field, 'FILL_FAILED', fillResult.reason));
        break;
      case 'stale':
      case 'requires_rescan':
      case 'unsupported':
        summary.unresolved += 1;
        unresolvedFields.push(unresolved(field, 'FILL_FAILED', fillResult.reason));
        break;
    }
  }

  return { autofillSummary: summary, unresolvedFields, answeredFields };
}
