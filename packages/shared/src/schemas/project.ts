import { z } from 'zod';
import {
  approvalFieldsSchema,
  isoDateSchema,
  isoDateTimeSchema,
  tagsSchema,
  uuidSchema,
} from './common';

export const projectSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    sourceFactId: uuidSchema.nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    role: z.string().nullable(),
    startDate: isoDateSchema.nullable(),
    endDate: isoDateSchema.nullable(),
    url: z.string().url().nullable(),
    tags: tagsSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .merge(approvalFieldsSchema);
export type Project = z.infer<typeof projectSchema>;

export const projectInputSchema = projectSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const projectUpdateSchema = projectInputSchema.partial();
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
