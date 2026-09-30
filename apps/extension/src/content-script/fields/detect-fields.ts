import {
  classifyField,
  detectedFieldSchema,
  type DetectedField,
  type FieldSignals,
} from '@career-os/shared';

export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const NON_DATA_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);

/** `autocomplete` tokens that only ever mean a credential or sign-in identity. */
const AUTH_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'username',
]);

/**
 * Credential/verification wording in a field's own attributes or label. `pass(word|wd|code|phrase)`
 * needs no boundary (camelCase `userPassword`, snake `user_password`) and can't match "passport";
 * the short tokens need non-alphanumeric boundaries so e.g. "photo" never matches `otp`.
 */
const AUTH_TEXT_PATTERN =
  /pass(?:word|wd|code|phrase)|(?<![a-z])pwd(?![a-z])|one[\s_-]?time[\s_-]?(?:code|pass)|(?<![a-z0-9])(?:otp|2fa|mfa|totp)(?![a-z0-9])|verification[\s_-]?code|authenticat(?:ion|or)[\s_-]?code/i;

/** A form with a password input and at most this many other data fields is a sign-in/sign-up box,
 * not an application form — every field in it (usually just the email/username) is excluded.
 * Application forms that embed a "create a password" step have far more fields than this and are
 * still scanned, minus the password input itself. */
const LOGIN_FORM_MAX_OTHER_FIELDS = 2;

function isDataControl(control: FormControl): boolean {
  return control.tagName !== 'INPUT' || !NON_DATA_INPUT_TYPES.has(getInputType(control));
}

function isInLoginForm(field: FormControl): boolean {
  const form = field.closest('form');
  if (!form || !form.querySelector('input[type="password"]')) return false;
  const otherDataFields = [
    ...form.querySelectorAll<FormControl>('input, select, textarea'),
  ].filter((control) => isDataControl(control) && getInputType(control) !== 'password');
  return otherDataFields.length <= LOGIN_FORM_MAX_OTHER_FIELDS;
}

/**
 * AUTHENTICATION (CLAUDE.md: never read, not extract-then-ignore). Beyond `type="password"`, this
 * catches a password revealed by a "show password" toggle (now `type="text"` but still named
 * like one), one-time/2FA codes, and the username/email box of a sign-in form — all excluded
 * before their value is ever read.
 */
function isAuthenticationField(field: FormControl, inputType: string, document: Document): boolean {
  if (inputType === 'password') return true;

  const autocompleteTokens = (field.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (autocompleteTokens.some((token) => AUTH_AUTOCOMPLETE_TOKENS.has(token))) return true;

  const ownText = [
    field.getAttribute('name'),
    field.getAttribute('id'),
    field.getAttribute('aria-label'),
    field.getAttribute('placeholder'),
    findLabelText(field, document),
  ]
    .filter(Boolean)
    .join(' ');
  if (AUTH_TEXT_PATTERN.test(ownText)) return true;

  return isInLoginForm(field);
}

function findLabelText(field: Element, document: Document): string | null {
  const id = field.getAttribute('id');
  if (id) {
    for (const label of document.querySelectorAll('label')) {
      if (label.getAttribute('for') === id) {
        return label.textContent?.trim() || null;
      }
    }
  }
  return field.closest('label')?.textContent?.trim() || null;
}

/** Nearest preceding h1-h4, searched by walking up through ancestors and each ancestor's
 * preceding siblings — approximates "which section of the form is this field in" without a
 * real layout engine. */
function findSectionHeading(field: Element): string | null {
  let current: Element | null = field;
  while (current) {
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (/^H[1-4]$/.test(sibling.tagName)) {
        return sibling.textContent?.trim() || null;
      }
      const nested = sibling.querySelector('h1, h2, h3, h4');
      if (nested?.textContent) return nested.textContent.trim();
      sibling = sibling.previousElementSibling;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Text of the sibling nodes immediately preceding this field (e.g. a question posed as a <p>
 * right before a radio group), stopping at the previous form control. Deliberately does NOT use
 * the field's parent's full textContent — on a form with no per-field wrapper divs (common in
 * real-world markup, where labels/inputs are flat siblings under one <form>), that would pull
 * in every other field's label text too, since they all share the same parent.
 */
function findNearbyText(field: Element): string | null {
  const texts: string[] = [];
  let node: ChildNode | null = field.previousSibling;
  let steps = 0;

  while (node && steps < 10) {
    if (node.nodeType === node.ELEMENT_NODE) {
      const el = node as Element;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) break;
      const text = el.textContent?.trim();
      if (text) texts.unshift(text);
    } else if (node.nodeType === node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) texts.unshift(text);
    }
    node = node.previousSibling;
    steps += 1;
  }

  return texts.length > 0 ? texts.join(' ') : null;
}

// tagName comparisons, not `instanceof HTMLInputElement` etc. — this runs against documents
// that may come from a different realm than this module's own ambient globals (e.g. a
// standalone `new JSDOM()` instance in tests, or a page's own window in the real content
// script), and `instanceof` against an ambient class fails silently across realms since each
// has its own distinct HTMLInputElement/HTMLSelectElement/HTMLTextAreaElement constructor.
function getInputType(field: FormControl): string {
  if (field.tagName === 'TEXTAREA') return 'textarea';
  if (field.tagName === 'SELECT') return 'select-one';
  return (field as HTMLInputElement).type || 'text';
}

/**
 * Best-effort "does this field already have something in it" snapshot, feeding Phase 4's
 * "Already completed" review state (docs/IMPLEMENTATION_PLAN.md). Deliberately conservative:
 * skipped entirely for checkbox/radio/file (a single control's checked/empty state, or a
 * browser-restricted file input value, isn't a meaningful text snapshot the way an input/
 * textarea/select's content is), and for select elements this can't distinguish a real first
 * option from an unset one sitting at selectedIndex 0 — a false negative (missing an actually-
 * completed select) is preferred over a false positive that hides a field the user still needs
 * to fill.
 */
export function readCurrentValue(field: FormControl, inputType: string): string | null {
  if (inputType === 'checkbox' || inputType === 'radio' || inputType === 'file') return null;

  if (field.tagName === 'SELECT') {
    const select = field as HTMLSelectElement;
    const text = select.options[select.selectedIndex]?.textContent?.trim();
    return text ? text : null;
  }

  const value = (field as HTMLInputElement | HTMLTextAreaElement).value?.trim();
  return value ? value : null;
}

export interface ScannedControl {
  element: FormControl;
  field: DetectedField;
}

/**
 * Walks every form control on the page and pairs each with both its live element and its
 * classified DetectedField snapshot. Shared by detectFields (Phase 2 analysis — snapshot only,
 * DetectedField[] never carries a live reference) and the Phase 4B fill engine (which needs the
 * live element to re-resolve and write to, matched by fingerprint against a previously-approved
 * DetectedField — see lib/field-fingerprint.ts). AUTHENTICATION fields (see
 * isAuthenticationField: passwords, revealed passwords, one-time codes, sign-in forms) are
 * excluded here, before classification ever runs — per CLAUDE.md, "never extract-then-ignore."
 * Non-data controls (hidden/submit/button/image/reset inputs) are skipped too, since they're not
 * something a user answers — and, for the fill engine, this is also what guarantees it can never
 * reach a submit/button control at all, structurally, not by a runtime check.
 */
export function scanFormControls(document: Document): ScannedControl[] {
  const controls = document.querySelectorAll<FormControl>('input, select, textarea');
  const results: ScannedControl[] = [];
  let index = 0;

  for (const field of controls) {
    const inputType = getInputType(field);

    if (field.tagName === 'INPUT' && NON_DATA_INPUT_TYPES.has(inputType)) continue;
    // AUTHENTICATION — excluded outright, before its value or signals are ever read.
    if (isAuthenticationField(field, inputType, document)) continue;

    const selectOptions =
      field.tagName === 'SELECT'
        ? [...(field as HTMLSelectElement).options].map(
            (option) => option.textContent?.trim() ?? '',
          ).filter(Boolean)
        : undefined;

    const signals: FieldSignals = {
      label: findLabelText(field, document),
      name: field.getAttribute('name'),
      id: field.getAttribute('id'),
      ariaLabel: field.getAttribute('aria-label'),
      placeholder: field.getAttribute('placeholder'),
      nearbyText: findNearbyText(field),
      sectionHeading: findSectionHeading(field),
      inputType,
      selectOptions,
    };

    const { classification, confidence } = classifyField(signals);

    results.push({
      element: field,
      field: detectedFieldSchema.parse({
        fieldId: `field-${index}`,
        label: signals.label,
        htmlName: signals.name,
        htmlId: signals.id,
        inputType,
        classification,
        confidence,
        selectOptions,
        currentValue: readCurrentValue(field, inputType),
      }),
    });
    index += 1;
  }

  return results;
}

/** Snapshot-only view of scanFormControls — used by the Phase 2 analysis flow, which sends
 * DetectedField[] across the content-script/popup message boundary and must never carry a live
 * DOM reference across it. */
export function detectFields(document: Document): DetectedField[] {
  return scanFormControls(document).map((entry) => entry.field);
}
