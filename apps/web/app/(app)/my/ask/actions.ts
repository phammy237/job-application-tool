'use server';

import { loadOwnEvidenceGraph } from '@career-os/database';
import { answerQuestion, type AskAnswer } from '@career-os/shared';
import { requireUser } from '../../../../lib/auth';
import { createClient } from '../../../../lib/supabase/server';
import { askQuestionSchema } from './ask-schema';

export type AskResult = { ok: true; answer: AskAnswer } | { ok: false; error: string };

/**
 * Deterministic retrieval over the caller's own stored evidence. No LLM is involved: the answer is
 * assembled from stored rows by `answerQuestion`, so nothing can be invented. The user id comes
 * from the verified session; the graph load is RLS-scoped and also filtered by user_id.
 */
export async function askMyEvidence(question: string): Promise<AskResult> {
  const user = await requireUser();
  const parsed = askQuestionSchema.safeParse(question);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid question.' };
  }
  try {
    const supabase = await createClient();
    const graph = await loadOwnEvidenceGraph(supabase, user.id);
    return { ok: true, answer: answerQuestion(graph, parsed.data, new Date()) };
  } catch (error) {
    console.error('[career-os] myOS ask failed', error);
    return { ok: false, error: 'Could not search your evidence right now. Please try again.' };
  }
}
