/** Renders a stored multi-line description as real bullets instead of one wrapped paragraph —
 * purely presentational (splits on the existing newline-separated text; never rewrites or
 * re-stores it). A single-line description stays a plain paragraph — a list of one item reads
 * worse than just a sentence. */
export function BulletedDescription({ description }: { description: string }) {
  const lines = description
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return <p className="mt-2 text-sm">{description}</p>;
  }

  return (
    <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm">
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}
