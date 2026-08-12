import { NEVER_SUGGEST_CLASSIFICATIONS, type DetectedField, type FieldClassification } from '@career-os/shared';

export interface FieldFingerprint {
  htmlName: string | null;
  htmlId: string | null;
  classification: FieldClassification;
  label: string | null;
  inputType: string;
  /** A change-detection hash of currentValue, never the raw text — see fingerprintField's doc
   * comment for why the raw value must never reach chrome.storage.local. */
  currentValueHash: string | null;
}

/**
 * Cheap, non-cryptographic hash — this exists only to detect "did this field's content change
 * since the stored review was written," not to resist an adversary. A rare collision means a
 * real edit goes undetected once in a while (falls back to reusing a slightly-stale decision),
 * never a security exposure — worst case is the same as not hashing at all.
 */
function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return `${value.length}:${hash}`;
}

/**
 * The minimal, persistable "is this materially the same field" descriptor — deliberately not
 * the full DetectedField. `currentValueHash` is null for DEMOGRAPHIC/LEGAL/AUTHENTICATION
 * fields unconditionally, and for every other field's *empty* value: a field that never gets a
 * suggestion or approval has no stale-decision risk to guard against, so there is no product
 * need to ever let its already-typed answer (potentially a disability/veteran-status selection,
 * a criminal-history response, a salary figure, a free-response essay) leave the live DOM, not
 * even as a hash. See CLAUDE.md's data-minimization rule and docs/IMPLEMENTATION_PLAN.md Phase
 * 4A's "persisted reviews must be revalidated against a changed current-value snapshot" note.
 */
export function fingerprintField(field: DetectedField): FieldFingerprint {
  const currentValueHash =
    !NEVER_SUGGEST_CLASSIFICATIONS.has(field.classification) && field.currentValue
      ? hashText(field.currentValue)
      : null;

  return {
    htmlName: field.htmlName,
    htmlId: field.htmlId,
    classification: field.classification,
    label: field.label,
    inputType: field.inputType,
    currentValueHash,
  };
}

/** True when a stored fingerprint still describes the freshly detected field — false for any
 * drift (label changed, classification changed, the field's current value changed, etc.),
 * meaning any decision recorded against the stored fingerprint must not be reused. */
export function fingerprintMatches(fingerprint: FieldFingerprint, field: DetectedField): boolean {
  const fresh = fingerprintField(field);
  return (
    fingerprint.htmlName === fresh.htmlName &&
    fingerprint.htmlId === fresh.htmlId &&
    fingerprint.classification === fresh.classification &&
    fingerprint.label === fresh.label &&
    fingerprint.inputType === fresh.inputType &&
    fingerprint.currentValueHash === fresh.currentValueHash
  );
}

/**
 * Identity-only comparison (everything fingerprintMatches checks except currentValueHash). Used
 * by the Phase 4B fill engine to re-resolve *which* live element a previously-approved field
 * refers to — content drift is checked separately, and more conservatively (see fill-engine.ts's
 * STALE outcome), once identity is uniquely resolved. Kept distinct from fingerprintMatches
 * rather than parameterized, so each call site's intent (storage revalidation vs. live
 * re-resolution) stays obvious from which function it calls.
 */
export function identityMatches(a: DetectedField, b: DetectedField): boolean {
  return (
    a.htmlName === b.htmlName &&
    a.htmlId === b.htmlId &&
    a.classification === b.classification &&
    a.label === b.label &&
    a.inputType === b.inputType
  );
}
