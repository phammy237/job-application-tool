import type { NodeType } from '@career-os/shared';

/** Real in-app page for a node, or null when no dedicated page exists. Pure. */
export function nodeHref(type: NodeType | 'SKILL', id: string): string | null {
  switch (type) {
    case 'PROJECT':
      return `/my/projects/${encodeURIComponent(id)}`;
    case 'SKILL':
      return '/my/skills';
    case 'STORY':
      return `/my/stories/${encodeURIComponent(id)}`;
    case 'EXPERIENCE':
    case 'EDUCATION':
      return '/profile';
    default:
      return null;
  }
}

/** Only http(s) URLs are ever rendered as links (blocks javascript:/data: stored in evidence). */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
