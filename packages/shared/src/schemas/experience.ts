import { z } from 'zod';
import {
  approvalFieldsSchema,
  isoDateSchema,
  isoDateTimeSchema,
  tagsSchema,
  uuidSchema,
} from './common';

export const experienceSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    sourceFactId: uuidSchema.nullable(),
    company: z.string().min(1),
    title: z.string().min(1),
    location: z.string().nullable(),
    employmentType: z.string().nullable(),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    description: z.string().nullable(),
    tags: tagsSchema,
    displayOrder: z.number().int().default(0),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .merge(approvalFieldsSchema);
export type Experience = z.infer<typeof experienceSchema>;

export const experienceInputSchema = experienceSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type ExperienceInput = z.infer<typeof experienceInputSchema>;

export const experienceUpdateSchema = experienceInputSchema.partial();
export type ExperienceUpdate = z.infer<typeof experienceUpdateSchema>;
