import { z } from 'zod';
import { emailClassificationSchema } from './email-signal';

/**
 * The Claude fallback classifier's raw-response contract (docs/EMAIL_INTEGRATION.md §1.5,
 * docs/AI_GROUNDING.md §8-style extension). Unlike generatedAnswerContractSchema/
 * requirementMappingRunContractSchema, this contract cites no ids from retrieved data — it only
 * classifies the one already-untrusted-tagged message placed in the prompt — so there is no
 * sourceFactIds/matchedFactIds-style allowlist to check. `evidence` is a short, human-readable
 * reason (e.g. "subject contains 'interview availability'"), never the model's reasoning trace.
 */
export const emailClassificationContractSchema = z.object({
  classification: emailClassificationSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string().max(200),
});
export type EmailClassificationContract = z.infer<typeof emailClassificationContractSchema>;
