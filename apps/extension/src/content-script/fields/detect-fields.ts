import { detectedFieldSchema, type DetectedField } from '@career-os/shared';
import { classifyField, type FieldSignals } from './classify-field';

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const NON_DATA_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'image', 'reset']);

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
function readCurrentValue(field: FormControl, inputType: string): string | null {
  if (inputType === 'checkbox' || inputType === 'radio' || inputType === 'file') return null;

  if (field.tagName === 'SELECT') {
    const select = field as HTMLSelectElement;
    const text = select.options[select.selectedIndex]?.textContent?.trim();
    return text ? text : null;
  }

  const value = (field as HTMLInputElement | HTMLTextAreaElement).value?.trim();
  return value ? value : null;
}

/**
 * Walks every form control on the page and builds a DetectedField[]. AUTHENTICATION fields
 * (password inputs) are excluded here, before classification ever runs — per CLAUDE.md, "never
 * extract-then-ignore." Non-data controls (hidden/submit/button/image/reset inputs) are skipped
 * too, since they're not something a user answers.
 */
export function detectFields(document: Document): DetectedField[] {
  const controls = document.querySelectorAll<FormControl>('input, select, textarea');
  const results: DetectedField[] = [];
  let index = 0;

  for (const field of controls) {
    const inputType = getInputType(field);

    if (field.tagName === 'INPUT') {
      if (inputType === 'password') continue; // AUTHENTICATION — excluded outright, never detected
      if (NON_DATA_INPUT_TYPES.has(inputType)) continue;
    }

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

    results.push(
      detectedFieldSchema.parse({
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
    );
    index += 1;
  }

  return results;
}
