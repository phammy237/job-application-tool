import 'server-only';
import { loadOwnEvidenceGraph } from '@career-os/database';
import type { EvidenceGraphData } from '@career-os/shared';
import { cache } from 'react';
import { createClient } from '../supabase/server';

/**
 * The signed-in user's evidence graph, loaded at most ONCE per server request: React `cache()`
 * memoizes per request, so a page, its layout and any nested server components (e.g. the
 * application page's two myOS panels) share one eight-query load instead of repeating it.
 *
 * `userId` MUST come from the verified session (`requireUser()` / `getCurrentUser()`); the session
 * client is used and every query inside `loadOwnEvidenceGraph` filters by that id (RLS is the
 * backstop). The memo is request-scoped, so nothing is shared between users or requests.
 * Callers must treat the returned graph as read-only.
 */
export const loadEvidenceGraphForRequest = cache(
  async (userId: string): Promise<EvidenceGraphData> => {
    const supabase = await createClient();
    return loadOwnEvidenceGraph(supabase, userId);
  },
);
