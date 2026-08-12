import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import type { DetectedField, GeneratedAnswer, ReviewableField } from '@career-os/shared';
import { detectFields } from '../fields/detect-fields';
import { runFillEngine, type FillResult } from './fill-engine';

function loadDom(html: string): Document {
  return new JSDOM(html).window.document;
}

function answer(overrides: Partial<GeneratedAnswer> = {}): GeneratedAnswer {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    applicationId: null,
    jobId: '33333333-3333-4333-8333-333333333333',
    fieldLabel: 'Full Name',
    fieldClassification: 'BASIC_PROFILE',
    answer: 'Jane Doe',
    confidence: 0.9,
    sourceFactIds: ['44444444-4444-4444-8444-444444444444'],
    reasoningSummary: 'From your profile.',
    unsupportedClaims: [],
    requiresUserReview: true,
    userDecision: null,
    finalText: null,
    insufficientData: false,
    rejectionReason: null,
    availableFactIds: null,
    generationRunId: null,
    attemptNumber: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function findDetected(document: Document, htmlName: string): DetectedField {
  const found = detectFields(document).find((f) => f.htmlName === htmlName);
  if (!found) throw new Error(`No detected field with htmlName "${htmlName}" — check the fixture HTML.`);
  return found;
}

function reviewableField(
  document: Document,
  htmlName: string,
  overrides: Partial<ReviewableField> = {},
): ReviewableField {
  return {
    detected: findDetected(document, htmlName),
    reviewState: 'READY',
    approvalState: 'APPROVED',
    suggestion: answer(),
    editedText: null,
    errorMessage: null,
    ...overrides,
  };
}

function resultFor(results: FillResult[], fieldId: string): FillResult {
  const found = results.find((r) => r.fieldId === fieldId);
  if (!found) throw new Error(`No result for fieldId "${fieldId}"`);
  return found;
}

const BASIC_FORM = `
  <form>
    <label for="full_name">Full Name</label>
    <input id="full_name" name="full_name" type="text" />

    <label for="email">Email</label>
    <input id="email" name="email" type="email" />

    <label for="notes">Notes</label>
    <textarea id="notes" name="notes"></textarea>

    <label for="school">School</label>
    <select id="school" name="school">
      <option value="">Select a school</option>
      <option value="ufl">University of Florida</option>
      <option value="fsu">Florida State University</option>
    </select>

    <p>Are you legally authorized to work in the United States?</p>
    <label for="work_auth_yes">Yes</label>
    <input id="work_auth_yes" name="work_auth" type="radio" value="yes" />
    <label for="work_auth_no">No</label>
    <input id="work_auth_no" name="work_auth" type="radio" value="no" />

    <label for="newsletter">Subscribe to updates</label>
    <input id="newsletter" name="newsletter" type="checkbox" />

    <button type="submit" id="submit-btn">Submit application</button>
  </form>
`;

describe('runFillEngine — approval gating', () => {
  it('fills an APPROVED field', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', { suggestion: answer({ answer: 'Jane Doe' }) }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('success');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('Jane Doe');
  });

  it('never fills a PENDING (not-yet-decided) field, even if it has a suggestion attached', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', { approvalState: 'PENDING' }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('skipped');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('');
  });

  it('never fills a SKIPPED field', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', { approvalState: 'SKIPPED' }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('skipped');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('');
  });

  it('fills an EDITED field using editedText, not the original suggestion answer', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', {
        approvalState: 'EDITED',
        editedText: 'Jane A. Doe',
        suggestion: answer({ answer: 'Jane Doe' }),
      }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('success');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('Jane A. Doe');
  });
});

describe('runFillEngine — sensitive and pending fields cannot reach the fill engine', () => {
  it('refuses a DEMOGRAPHIC field even if malformed into an APPROVED state', () => {
    const dom = loadDom(`
      <form>
        <label for="gender">Gender</label>
        <select id="gender" name="gender">
          <option value="">Select one</option>
          <option>Female</option>
          <option>Male</option>
        </select>
      </form>
    `);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'gender', {
        reviewState: 'READY',
        approvalState: 'APPROVED',
        suggestion: answer({ answer: 'Female', fieldClassification: 'DEMOGRAPHIC' }),
      }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('unsupported');
    // Untouched — still the blank placeholder, never advanced to "Female".
    expect((dom.getElementById('gender') as HTMLSelectElement).value).toBe('');
  });

  it('refuses a field whose reviewState is not decidable (PENDING_SUGGESTION), even if approvalState was somehow set to APPROVED', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', {
        reviewState: 'PENDING_SUGGESTION',
        approvalState: 'APPROVED',
        suggestion: null,
      }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('unsupported');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('');
  });

  it('refuses an AUTHENTICATION-classified field defensively, even though the detector never produces one', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', {
        detected: { ...findDetected(dom, 'full_name'), classification: 'AUTHENTICATION' },
      }),
    ]);
    expect(resultFor(results, 'field-0').status).toBe('unsupported');
  });
});

describe('runFillEngine — existing values are preserved', () => {
  it('does not overwrite a field whose live value changed since it was reviewed (STALE)', () => {
    const dom = loadDom(BASIC_FORM);
    const field = reviewableField(dom, 'full_name'); // detected.currentValue is null (was empty)
    (dom.getElementById('full_name') as HTMLInputElement).value = 'Typed by the user meanwhile';

    const results = runFillEngine(dom, [field]);
    expect(resultFor(results, 'field-0').status).toBe('stale');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe(
      'Typed by the user meanwhile',
    );
  });

  it('fills a field that was ALREADY_COMPLETED at review time and explicitly approved as a replacement, when its live value has not changed since', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('full_name') as HTMLInputElement).value = 'John';
    const field = reviewableField(dom, 'full_name', {
      reviewState: 'READY',
      approvalState: 'APPROVED',
      suggestion: answer({ answer: 'Jane Doe' }),
    });
    // field.detected.currentValue is "John" (captured above, before approval) — live value is
    // still "John", unchanged since review, so the prior "suggest a replacement anyway" +
    // approve decision is honored.
    expect(field.detected.currentValue).toBe('John');

    const results = runFillEngine(dom, [field]);
    expect(resultFor(results, 'field-0').status).toBe('success');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('Jane Doe');
  });

  it('does not overwrite when the ALREADY_COMPLETED value changed again after being reviewed', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('full_name') as HTMLInputElement).value = 'John';
    const field = reviewableField(dom, 'full_name'); // detected.currentValue = "John"
    (dom.getElementById('full_name') as HTMLInputElement).value = 'John Q. Public'; // drifted again

    const results = runFillEngine(dom, [field]);
    expect(resultFor(results, 'field-0').status).toBe('stale');
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('John Q. Public');
  });
});

describe('runFillEngine — native and React-compatible events fire', () => {
  it('dispatches input, change, and blur events on a text field', () => {
    const dom = loadDom(BASIC_FORM);
    const element = dom.getElementById('full_name') as HTMLInputElement;
    const seen: string[] = [];
    element.addEventListener('input', () => seen.push('input'));
    element.addEventListener('change', () => seen.push('change'));
    element.addEventListener('blur', () => seen.push('blur'));

    runFillEngine(dom, [reviewableField(dom, 'full_name')]);

    expect(seen).toEqual(['input', 'change', 'blur']);
  });

  it('writes through the native prototype setter, bypassing a React-style instance-level value tracker, and still fires input so React would reconcile', () => {
    const dom = loadDom(BASIC_FORM);
    const element = dom.getElementById('full_name') as HTMLInputElement;

    // Faithfully mirrors React's real trackValueOnNode mechanism (react-dom's ReactDOMInput):
    // an own-property descriptor on the instance whose setter still delegates to the native
    // setter (so a plain `element.value = x` from anywhere else keeps working correctly) but
    // also increments a "React saw this write" counter. The point of calling the *prototype's*
    // setter directly (what setNativeValue in fill-engine.ts does) is to update the real value
    // without that counter ever incrementing — the divergence between the real value and what
    // React's tracker last recorded is exactly what makes React notice the `input` event matters
    // and reconcile its state, instead of assuming nothing changed and ignoring it.
    const nativeDescriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!;
    let reactSawDirectAssignment = 0;
    Object.defineProperty(element, 'value', {
      configurable: true,
      get: nativeDescriptor.get,
      set(v: string) {
        reactSawDirectAssignment += 1;
        nativeDescriptor.set!.call(this, v);
      },
    });

    let inputEventFired = false;
    element.addEventListener('input', () => {
      inputEventFired = true;
    });

    const results = runFillEngine(dom, [
      reviewableField(dom, 'full_name', { suggestion: answer({ answer: 'Jane Doe' }) }),
    ]);

    expect(resultFor(results, 'field-0').status).toBe('success');
    // The real value was updated (readable through the instance's own getter, which delegates
    // to the native getter) ...
    expect(element.value).toBe('Jane Doe');
    // ... but React's own instance-level setter was never invoked to do it — proving the fill
    // engine used the prototype setter directly rather than a plain `element.value =` assignment.
    expect(reactSawDirectAssignment).toBe(0);
    expect(inputEventFired).toBe(true);
  });
});

describe('runFillEngine — control-type behavior', () => {
  it('fills a textarea', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'notes', {
        detected: findDetected(dom, 'notes'),
        suggestion: answer({ answer: 'Excited to apply.' }),
      }),
    ]);
    expect(resultFor(results, 'field-2').status).toBe('success');
    expect((dom.getElementById('notes') as HTMLTextAreaElement).value).toBe('Excited to apply.');
  });

  it('fills a select by matching option text (case-insensitive)', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'school', {
        detected: findDetected(dom, 'school'),
        suggestion: answer({ answer: 'university of florida' }),
      }),
    ]);
    expect(resultFor(results, 'field-3').status).toBe('success');
    expect((dom.getElementById('school') as HTMLSelectElement).value).toBe('ufl');
  });

  it('returns unsupported for a select with no matching option, and does not change the selection', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'school', {
        detected: findDetected(dom, 'school'),
        suggestion: answer({ answer: 'Harvard' }),
      }),
    ]);
    expect(resultFor(results, 'field-3').status).toBe('unsupported');
    expect((dom.getElementById('school') as HTMLSelectElement).value).toBe('');
  });

  it('checks the approved radio option', () => {
    const dom = loadDom(BASIC_FORM);
    const yesField = reviewableField(dom, 'work_auth', {
      detected: detectFields(dom).find((f) => f.label === 'Yes')!,
      suggestion: answer({ answer: 'Yes' }),
    });
    const results = runFillEngine(dom, [yesField]);
    expect(results[0]!.status).toBe('success');
    expect((dom.getElementById('work_auth_yes') as HTMLInputElement).checked).toBe(true);
    expect((dom.getElementById('work_auth_no') as HTMLInputElement).checked).toBe(false);
  });

  it('skips a radio option when another option in the same group is already selected — never silently overwrite an existing selection', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('work_auth_no') as HTMLInputElement).checked = true;
    const yesField = reviewableField(dom, 'work_auth', {
      detected: detectFields(dom).find((f) => f.label === 'Yes')!,
      suggestion: answer({ answer: 'Yes' }),
    });

    const results = runFillEngine(dom, [yesField]);
    expect(results[0]!.status).toBe('skipped');
    expect((dom.getElementById('work_auth_yes') as HTMLInputElement).checked).toBe(false);
    expect((dom.getElementById('work_auth_no') as HTMLInputElement).checked).toBe(true);
  });

  it('checks a checkbox for an affirmative approved answer', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'newsletter', {
        detected: findDetected(dom, 'newsletter'),
        suggestion: answer({ answer: 'Yes' }),
      }),
    ]);
    expect(results[0]!.status).toBe('success');
    expect((dom.getElementById('newsletter') as HTMLInputElement).checked).toBe(true);
  });

  it('returns unsupported for a checkbox whose approved answer cannot be confidently interpreted as boolean', () => {
    const dom = loadDom(BASIC_FORM);
    const results = runFillEngine(dom, [
      reviewableField(dom, 'newsletter', {
        detected: findDetected(dom, 'newsletter'),
        suggestion: answer({ answer: 'Maybe, depends on the day' }),
      }),
    ]);
    expect(results[0]!.status).toBe('unsupported');
    expect((dom.getElementById('newsletter') as HTMLInputElement).checked).toBe(false);
  });
});

describe('runFillEngine — fails closed for hidden/disabled/readonly/ambiguous/stale/missing targets', () => {
  it('fails a disabled field', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('full_name') as HTMLInputElement).disabled = true;
    const results = runFillEngine(dom, [reviewableField(dom, 'full_name')]);
    expect(resultFor(results, 'field-0').status).toBe('failed');
  });

  it('fails a readonly field', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('full_name') as HTMLInputElement).readOnly = true;
    const results = runFillEngine(dom, [reviewableField(dom, 'full_name')]);
    expect(resultFor(results, 'field-0').status).toBe('failed');
  });

  it('fails a hidden field (inline style)', () => {
    const dom = loadDom(BASIC_FORM);
    (dom.getElementById('full_name') as HTMLInputElement).style.display = 'none';
    const results = runFillEngine(dom, [reviewableField(dom, 'full_name')]);
    expect(resultFor(results, 'field-0').status).toBe('failed');
  });

  it('fails a field hidden via the `hidden` attribute on an ancestor', () => {
    const dom = loadDom(BASIC_FORM);
    dom.getElementById('full_name')!.parentElement!.setAttribute('hidden', '');
    const results = runFillEngine(dom, [reviewableField(dom, 'full_name')]);
    expect(resultFor(results, 'field-0').status).toBe('failed');
  });

  it('requires a rescan when the field no longer exists on the page (missing)', () => {
    const dom = loadDom(BASIC_FORM);
    const field = reviewableField(dom, 'full_name');
    dom.getElementById('full_name')!.remove();

    const results = runFillEngine(dom, [field]);
    expect(resultFor(results, 'field-0').status).toBe('requires_rescan');
  });

  it('requires a rescan when the fingerprint now matches more than one live element (ambiguous)', () => {
    const dom = loadDom(BASIC_FORM);
    const field = reviewableField(dom, 'full_name');
    const duplicate = dom.getElementById('full_name')!.cloneNode(true) as HTMLElement;
    dom.getElementById('full_name')!.after(duplicate);

    const results = runFillEngine(dom, [field]);
    expect(resultFor(results, 'field-0').status).toBe('requires_rescan');
  });
});

describe('runFillEngine — page/field changes require rescan', () => {
  it('requires a rescan when the field at the same position now has a different classification/label (page changed underneath the review)', () => {
    const dom = loadDom(BASIC_FORM);
    const staleField = reviewableField(dom, 'full_name');
    // Simulate the page having been re-purposed: swap the element's label/name entirely.
    const el = dom.getElementById('full_name') as HTMLInputElement;
    el.name = 'salary';
    el.id = 'salary';
    dom.querySelector('label[for="full_name"]')!.setAttribute('for', 'salary');
    dom.querySelector('label[for="salary"]')!.textContent = 'Desired salary';

    const results = runFillEngine(dom, [staleField]);
    expect(resultFor(results, 'field-0').status).toBe('requires_rescan');
  });
});

describe('runFillEngine — partial success is represented correctly', () => {
  it('returns an independent, correctly-typed result per field in a mixed batch', () => {
    const dom = loadDom(BASIC_FORM);
    const fields = [
      reviewableField(dom, 'full_name', { suggestion: answer({ answer: 'Jane Doe' }) }),
      reviewableField(dom, 'email', { approvalState: 'SKIPPED', detected: findDetected(dom, 'email') }),
      reviewableField(dom, 'school', {
        detected: findDetected(dom, 'school'),
        suggestion: answer({ answer: 'Nonexistent University' }),
      }),
    ];

    const results = runFillEngine(dom, fields);

    expect(results).toHaveLength(3);
    expect(resultFor(results, 'field-0').status).toBe('success');
    expect(resultFor(results, 'field-1').status).toBe('skipped');
    expect(resultFor(results, 'field-3').status).toBe('unsupported');
    // The successful field's write did not depend on / get blocked by the other two.
    expect((dom.getElementById('full_name') as HTMLInputElement).value).toBe('Jane Doe');
  });

  it('does not let one field throwing abort the rest of the batch', () => {
    const dom = loadDom(BASIC_FORM);
    const goodField = reviewableField(dom, 'full_name', { suggestion: answer({ answer: 'Jane Doe' }) });
    // A field whose detected snapshot doesn't match anything live — resolves to requires_rescan,
    // not a thrown exception, but this also exercises that a non-success outcome for one field
    // never prevents another field's fill from completing.
    const brokenField = reviewableField(dom, 'full_name', {
      detected: { ...findDetected(dom, 'full_name'), fieldId: 'field-x', htmlName: 'does-not-exist' },
    });

    const results = runFillEngine(dom, [brokenField, goodField]);
    expect(resultFor(results, 'field-x').status).toBe('requires_rescan');
    expect(resultFor(results, 'field-0').status).toBe('success');
  });
});

describe('runFillEngine — never touches navigation/submission controls', () => {
  it('never clicks or otherwise interacts with a submit button, even when present in the batch scan', () => {
    const dom = loadDom(BASIC_FORM);
    let submitClicked = false;
    dom.getElementById('submit-btn')!.addEventListener('click', () => {
      submitClicked = true;
    });

    runFillEngine(dom, [reviewableField(dom, 'full_name')]);

    expect(submitClicked).toBe(false);
  });

  it('the live-control scan the fill engine resolves against never includes button/submit elements at all', () => {
    const dom = loadDom(BASIC_FORM);
    const fieldsWithButtonName = detectFields(dom).filter((f) => f.inputType === 'submit');
    expect(fieldsWithButtonName).toHaveLength(0);
  });
});
