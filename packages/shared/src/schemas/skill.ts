import { z } from 'zod';
import { approvalFieldsSchema, isoDateTimeSchema, uuidSchema } from './common';

export const skillSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    sourceFactId: uuidSchema.nullable(),
    name: z.string().min(1),
    category: z.string().nullable(),
    proficiency: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .merge(approvalFieldsSchema);
export type Skill = z.infer<typeof skillSchema>;

export const skillInputSchema = skillSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type SkillInput = z.infer<typeof skillInputSchema>;

export const skillUpdateSchema = skillInputSchema.partial();
export type SkillUpdate = z.infer<typeof skillUpdateSchema>;
