import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const resumeExtractionStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETE',
  'FAILED',
]);
export type ResumeExtractionStatus = z.infer<typeof resumeExtractionStatusSchema>;

export const resumeSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  label: z.string().nullable(),
  isPrimary: z.boolean().default(false),
  extractionStatus: resumeExtractionStatusSchema.default('PENDING'),
  extractedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Resume = z.infer<typeof resumeSchema>;
