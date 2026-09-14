/** Small, dependency-free array helpers for the Studio's local draft editing — array order *is*
 * display order (docs/IMPLEMENTATION_PLAN.md "Phase 7C" §10/§22), so every one of these returns
 * a new array in the intended order rather than mutating in place (React state must see a new
 * reference to re-render, and immutable version semantics elsewhere in this schema make "always
 * return a new value" the consistent habit to keep here too). */

export function updateAt<T>(items: T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, i) => (i === index ? updater(item) : item));
}

export function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function moveAt<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as T);
  return next;
}

export function insertAt<T>(items: T[], item: T): T[] {
  return [...items, item];
}
