import type { DetectedField } from '@career-os/shared';

/**
 * Read-only display of what was detected — no approve/edit/skip controls here. Phase 2 is
 * extraction + classification only; suggestions and autofill are Phase 3/4
 * (docs/IMPLEMENTATION_PLAN.md).
 */
export function FieldList({ fields }: { fields: DetectedField[] }) {
  if (fields.length === 0) {
    return <p style={{ fontSize: 13, color: '#666' }}>No form fields detected on this page.</p>;
  }

  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>
        Detected fields ({fields.length})
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {fields.map((field) => (
          <li
            key={field.fieldId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid #eee',
              fontSize: 13,
            }}
          >
            <span>{field.label ?? field.htmlName ?? field.htmlId ?? '(unlabeled field)'}</span>
            <span style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>
              {field.classification}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
