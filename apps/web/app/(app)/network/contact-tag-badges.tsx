import { Badge } from '@career-os/ui';
import type { ContactTag } from '@career-os/shared';

/** Small, title-cased label for a SCREAMING_SNAKE_CASE tag/role constant — "HIRING_MANAGER"
 * reads as "Hiring manager". Purely cosmetic; the underlying value passed to the server is
 * always the real enum member. */
export function formatEnumLabel(value: string): string {
  const words = value.split('_');
  return words
    .map((w, i) => (i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

export function ContactTagBadges({ tags }: { tags: ContactTag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary">
          {formatEnumLabel(tag)}
        </Badge>
      ))}
    </div>
  );
}
