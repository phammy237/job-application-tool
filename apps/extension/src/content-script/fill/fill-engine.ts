import { isDecidable, NEVER_SUGGEST_CLASSIFICATIONS, type ReviewableField } from '@career-os/shared';
import { identityMatches } from '../../lib/field-fingerprint';
import { readCurrentValue, scanFormControls, type FormControl, type ScannedControl } from '../fields/detect-fields';

export type FillStatus = 'success' | 'skipped' | 'failed' | 'stale' | 'unsupported' | 'requires_rescan';

export interface FillResult {
  fieldId: string;
  status: FillStatus;
  /** Always a category-level explanation — never the approved answer text or the field's live
   * value, so this is safe to log or display without leaking anything sensitive. */
  reason: string;
}

const HIGHLIGHT_DURATION_MS = 1500;
const HIGHLIGHT_OUTLINE = '2px solid #2563eb';

const AFFIRMATIVE_ANSWERS = new Set(['yes', 'true', 'agree', 'confirm', 'i agree', 'checked']);
const NEGATIVE_ANSWERS = new Set(['no', 'false', 'disagree', 'decline', 'unchecked']);

/**
 * The one centralized place that ever mutates the DOM for autofill (docs/IMPLEMENTATION_PLAN.md
 * Phase 4B). Every field is independently re-resolved and validated against the *current* page
 * state — nothing about a field's eligibility is trusted from the caller, since this runs in a
 * freshly injected content-script execution reached only via a serialized message, not a direct
 * function call any of the popup's own guards could intercept. Never throws for a single field's
 * failure; every field gets its own try/catch so one bad field can't abort the rest of the batch.
 */
export function runFillEngine(document: Document, fields: ReviewableField[]): FillResult[] {
  const liveControls = scanFormControls(document);

  const resolved = fields.map((field) => ({
    field,
    resolution: resolveIdentity(field, liveControls),
  }));

  const conflictingFieldIds = findConflictingRadioGroups(resolved);

  return resolved.map(({ field, resolution }) =>
    fillOne(field, resolution, liveControls, conflictingFieldIds.has(field.detected.fieldId)),
  );
}

type IdentityResolution =
  | { status: 'resolved'; control: ScannedControl }
  | { status: 'requires_rescan' };

function resolveIdentity(field: ReviewableField, liveControls: ScannedControl[]): IdentityResolution {
  const matches = liveControls.filter((entry) => identityMatches(field.detected, entry.field));
  if (matches.length !== 1) return { status: 'requires_rescan' };
  return { status: 'resolved', control: matches[0]! };
}

/**
 * Radio buttons in the same `name` group are mutually exclusive — if the caller approved more
 * than one field that resolves into the *same* live group, filling them in sequence would just
 * make whichever one runs last silently win, which is exactly the kind of unintended overwrite
 * this engine is supposed to prevent. Detected as a whole-batch pre-pass, before any writes
 * happen, so the outcome doesn't depend on iteration order.
 */
function findConflictingRadioGroups(
  resolved: { field: ReviewableField; resolution: IdentityResolution }[],
): Set<string> {
  const groupToFieldIds = new Map<string, string[]>();

  for (const { field, resolution } of resolved) {
    if (resolution.status !== 'resolved') continue;
    const { element } = resolution.control;
    if (element.tagName !== 'INPUT' || (element as HTMLInputElement).type !== 'radio') continue;
    const groupName = (element as HTMLInputElement).name;
    if (!groupName) continue;
    const existing = groupToFieldIds.get(groupName) ?? [];
    existing.push(field.detected.fieldId);
    groupToFieldIds.set(groupName, existing);
  }

  const conflicting = new Set<string>();
  for (const fieldIds of groupToFieldIds.values()) {
    if (fieldIds.length > 1) {
      for (const fieldId of fieldIds) conflicting.add(fieldId);
    }
  }
  return conflicting;
}

function fillOne(
  field: ReviewableField,
  resolution: IdentityResolution,
  liveControls: ScannedControl[],
  hasRadioConflict: boolean,
): FillResult {
  const fieldId = field.detected.fieldId;

  // Defense in depth — independently re-verify what review-reducer.ts already enforces, since
  // this runs in a separate script execution reached only via a message, not a direct call.
  if (NEVER_SUGGEST_CLASSIFICATIONS.has(field.detected.classification)) {
    return { fieldId, status: 'unsupported', reason: 'Sensitive fields are never auto-filled.' };
  }
  if (field.detected.inputType === 'file') {
    return { fieldId, status: 'unsupported', reason: 'File uploads are never auto-filled.' };
  }
  if (!isDecidable(field.reviewState)) {
    return { fieldId, status: 'unsupported', reason: 'This field has no approved suggestion.' };
  }
  if (field.approvalState !== 'APPROVED' && field.approvalState !== 'EDITED') {
    return { fieldId, status: 'skipped', reason: 'Not approved for autofill.' };
  }

  const text = field.approvalState === 'EDITED' ? field.editedText : field.suggestion?.answer;
  if (!text) {
    return { fieldId, status: 'unsupported', reason: 'No approved answer text is available.' };
  }

  if (resolution.status === 'requires_rescan') {
    return {
      fieldId,
      status: 'requires_rescan',
      reason: 'Could not uniquely locate this field on the page anymore — please rescan.',
    };
  }

  if (hasRadioConflict) {
    return {
      fieldId,
      status: 'failed',
      reason: 'Multiple approved fields target the same option group — resolve the conflict and rescan.',
    };
  }

  const { element, field: liveField } = resolution.control;

  // Content drift: the field is still the same field, but what's actually in it right now
  // differs from what it was when this decision was approved — never trust an old decision
  // against new content, whether that content appeared, disappeared, or just changed.
  const liveValue = readCurrentValue(element, liveField.inputType);
  if (liveValue !== field.detected.currentValue) {
    return {
      fieldId,
      status: 'stale',
      reason: "This field's content changed since it was reviewed — please rescan.",
    };
  }

  const hiddenReason = findUnfillableReason(element);
  if (hiddenReason) {
    return { fieldId, status: 'failed', reason: hiddenReason };
  }

  try {
    return fillControl(fieldId, element, liveField.inputType, text, liveControls);
  } catch {
    return { fieldId, status: 'failed', reason: 'An unexpected error occurred while filling this field.' };
  }
}

function findUnfillableReason(element: FormControl): string | null {
  if (!element.isConnected) return 'This field is no longer attached to the page.';
  if (element.disabled) return 'This field is disabled.';
  if ('readOnly' in element && element.readOnly) return 'This field is read-only.';
  if (isHidden(element)) return 'This field is hidden.';
  return null;
}

/**
 * Attribute/inline-style based only — jsdom (and this heuristic) can't evaluate real layout or
 * external stylesheets, so a field hidden purely via a CSS class from a stylesheet won't be
 * caught. Deliberately conservative in the safe direction: this can under-detect "hidden"
 * (leaving a genuinely-hidden field to fail some other way, or fill when it arguably shouldn't)
 * but never over-detects it, so it never blocks a legitimately visible field.
 */
function isHidden(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden) return true;
    if (current.style.display === 'none' || current.style.visibility === 'hidden') return true;
    current = current.parentElement;
  }
  return false;
}

function fillControl(
  fieldId: string,
  element: FormControl,
  inputType: string,
  text: string,
  liveControls: ScannedControl[],
): FillResult {
  if (element.tagName === 'SELECT') {
    return fillSelect(fieldId, element as HTMLSelectElement, text);
  }
  if (inputType === 'radio') {
    return fillRadio(fieldId, element as HTMLInputElement, liveControls);
  }
  if (inputType === 'checkbox') {
    return fillCheckbox(fieldId, element as HTMLInputElement, text);
  }
  if (element.tagName === 'TEXTAREA' || ['text', 'email', 'tel'].includes(inputType)) {
    return fillTextLike(fieldId, element as HTMLInputElement | HTMLTextAreaElement, text);
  }
  return { fieldId, status: 'unsupported', reason: `Unsupported control type: ${inputType}.` };
}

/** Sets .value via the element's own prototype setter (bypassing any framework's overridden
 * instance setter, e.g. React's), then dispatches the events a controlled component listens
 * for — the standard technique for writing into a React-controlled input from outside React. */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype =
    element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : element.tagName === 'SELECT'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}

function fillTextLike(fieldId: string, element: HTMLInputElement | HTMLTextAreaElement, text: string): FillResult {
  setNativeValue(element, text);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  highlight(element);
  return { fieldId, status: 'success', reason: 'Filled.' };
}

function fillSelect(fieldId: string, element: HTMLSelectElement, text: string): FillResult {
  const normalize = (value: string) => value.trim().toLowerCase();
  const target = normalize(text);
  const options = [...element.options];
  const match =
    options.find((option) => normalize(option.textContent ?? '') === target) ??
    options.find((option) => normalize(option.textContent ?? '').includes(target));

  if (!match) {
    return { fieldId, status: 'unsupported', reason: 'No matching option found for the approved answer.' };
  }

  setNativeValue(element, match.value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  highlight(element);
  return { fieldId, status: 'success', reason: 'Filled.' };
}

function fillRadio(fieldId: string, element: HTMLInputElement, liveControls: ScannedControl[]): FillResult {
  if (element.checked) {
    return { fieldId, status: 'skipped', reason: 'Already selected.' };
  }

  const groupName = element.name;
  const groupAlreadyAnswered = groupName
    ? liveControls.some(
        (entry) =>
          entry.element.tagName === 'INPUT' &&
          (entry.element as HTMLInputElement).type === 'radio' &&
          (entry.element as HTMLInputElement).name === groupName &&
          (entry.element as HTMLInputElement).checked,
      )
    : false;

  if (groupAlreadyAnswered) {
    return {
      fieldId,
      status: 'skipped',
      reason: 'Another option in this group is already selected.',
    };
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
  if (setter) {
    setter.call(element, true);
  } else {
    element.checked = true;
  }
  element.dispatchEvent(new Event('click', { bubbles: true }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  highlight(element);
  return { fieldId, status: 'success', reason: 'Filled.' };
}

function fillCheckbox(fieldId: string, element: HTMLInputElement, text: string): FillResult {
  const normalized = text.trim().toLowerCase();
  let desired: boolean | null = null;
  if (AFFIRMATIVE_ANSWERS.has(normalized)) desired = true;
  else if (NEGATIVE_ANSWERS.has(normalized)) desired = false;

  if (desired === null) {
    return {
      fieldId,
      status: 'unsupported',
      reason: 'Could not confidently interpret the approved answer as checked or unchecked.',
    };
  }

  if (element.checked === desired) {
    return { fieldId, status: 'skipped', reason: 'Already in the desired state.' };
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
  if (setter) {
    setter.call(element, desired);
  } else {
    element.checked = desired;
  }
  element.dispatchEvent(new Event('click', { bubbles: true }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  highlight(element);
  return { fieldId, status: 'success', reason: 'Filled.' };
}

/** Scrolls to and briefly outlines the field being filled, per docs/IMPLEMENTATION_PLAN.md
 * Phase 4B. Best-effort — scrollIntoView isn't implemented in jsdom, so both calls are guarded;
 * a missing scroll/highlight never fails the fill itself. */
function highlight(element: HTMLElement): void {
  try {
    element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  } catch {
    // no-op — layout/scrolling isn't available in every environment this runs in (e.g. tests)
  }
  const previousOutline = element.style.outline;
  element.style.outline = HIGHLIGHT_OUTLINE;
  setTimeout(() => {
    element.style.outline = previousOutline;
  }, HIGHLIGHT_DURATION_MS);
}
